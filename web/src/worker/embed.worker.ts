import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { CLASSIFIER_VERSION, SEED_TEXTS, SEED_TYPES, SEED_VERSION, TaskClassifier, labeledFor, type Prediction } from '../classify/classifier.ts'
import { DEFAULT_OPTIONS, DETECTOR_VERSION, detect, nullDistribution, quantile, summarize, withinConversationNull, type Candidate, type DetectInput, type DetectSummary } from '../detect/detector.ts'

import { installFetchAudit, setAuditProbes, takeAuditRecords, type NetRecord } from './netaudit.ts'
import { STATIC_MODEL_ID, StaticEmbedder, browserLoader } from '../classify/staticEmbed.ts'

// 모델은 1회 다운로드 후 Cache Storage에 캐시된다(transformers.js 기본 동작).
env.allowLocalModels = false
// 이 워커가 보내는 모든 요청(모델 다운로드 포함)을 감사한다. 원문 조각이 본문에 들어가면 기록된다.
// transformers.js는 import 시점에 globalThis.fetch를 env.fetch로 잡아두므로, 감싼 뒤 다시 넣어 준다.
installFetchAudit('embed-worker')
env.fetch = globalThis.fetch

// fetch로 안 잡히는 로드(ORT wasm 모듈 import 등)까지 전수 확인용: 리소스 타이밍 항목을 합친다(본문은 알 수 없음).
function allRecords(): NetRecord[] {
  const recs = takeAuditRecords()
  const seen = new Set(recs.map((r) => r.url))
  for (const e of performance.getEntriesByType('resource')) {
    if (seen.has(e.name)) continue
    seen.add(e.name)
    recs.push({ context: 'embed-worker(resource)', url: e.name, method: 'LOAD', bodyBytes: 0, containsText: false, at: Date.now() })
  }
  performance.clearResourceTimings()
  return recs
}

// 배치 안에서 가장 긴 문장 길이로 패딩되므로 작은 배치 + 길이순 정렬.
const BATCH = 16

export type EmbedIn =
  | { type: 'embed'; model: string; device: 'wasm' | 'webgpu'; texts: string[] } // 속도 측정용
  | { type: 'classify'; model: string; device: 'wasm' | 'webgpu'; texts: string[]; inputs: DetectInput[] } // inputs[i].text === texts[i]
export type EmbedOut =
  | { type: 'download'; file: string; percent: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; loadMs: number; embedMs: number; count: number; dim: number; net: NetRecord[] }
  | {
      type: 'classified'
      centroid: Prediction[]
      knn: Prediction[]
      linear: Prediction[] // 제품 기본(D). 가중치가 없는 모델이면 centroid와 같다
      embeddings: Float32Array
      dim: number
      embedMs: number
      candidates: Candidate[] // grade가 있는 쌍
      pairs: Candidate[] // 모든 쌍(제외 사유 포함, 개발 화면용)
      sims: number[] // 판단 가능 발화별 최대 유사도
      nullSims: number[] // 귀무분포(정렬됨)
      detectSummary: DetectSummary
      modelVersion: string
      classifierVersion: string
      detectorVersion: string
      net: NetRecord[] // 이 워커의 네트워크 요청 감사 기록
    }
  | { type: 'error'; message: string }

// 임베더: 문장 배열 → (n × dim) 벡터. 문맥 모델(transformers.js)과 정적 표(static-e5)를 같은 모양으로 감싼다.
type Embedder = (texts: string[]) => Promise<{ data: Float32Array; dim: number }>
const post = (m: EmbedOut, transfer: Transferable[] = []) => self.postMessage(m, { transfer })

async function load(model: string, device: 'wasm' | 'webgpu'): Promise<Embedder> {
  if (model === STATIC_MODEL_ID) {
    const se = await StaticEmbedder.load(browserLoader())
    return (texts) => se.embed(texts)
  }
  const pipe = (await pipeline('feature-extraction', model, {
    dtype: 'q8',
    device,
    progress_callback: (p: { status: string; file?: string; progress?: number }) => {
      if (p.status === 'progress' && p.file) post({ type: 'download', file: p.file, percent: Math.round(p.progress ?? 0) })
    },
  })) as FeatureExtractionPipeline
  return async (texts) => {
    const out = await pipe(texts, { pooling: 'mean', normalize: true })
    return { data: out.data as Float32Array, dim: out.dims[1] }
  }
}

// E5 계열은 "query: " 접두어 필수(정적 표는 토큰 평균이라 접두어 불필요)
const prep = (model: string, texts: string[]) => (model.includes('e5') && model !== STATIC_MODEL_ID ? texts.map((t) => 'query: ' + t) : texts)

// 길이순으로 묶어 임베딩하고 원래 순서로 되돌린다. 결과는 (n × dim) 한 덩어리.
async function embedAll(embed: Embedder, texts: string[], onProgress?: (done: number) => void): Promise<{ data: Float32Array; dim: number }> {
  const order = texts.map((_, i) => i).sort((a, b) => texts[a].length - texts[b].length)
  let data: Float32Array | null = null
  let dim = 0
  for (let i = 0; i < order.length; i += BATCH) {
    const idx = order.slice(i, i + BATCH)
    const out = await embed(idx.map((j) => texts[j]))
    dim = out.dim
    data ??= new Float32Array(texts.length * dim)
    idx.forEach((j, r) => data!.set(out.data.subarray(r * dim, (r + 1) * dim), j * dim))
    onProgress?.(Math.min(i + BATCH, order.length))
  }
  return { data: data ?? new Float32Array(0), dim }
}

const row = (data: Float32Array, dim: number, i: number) => data.subarray(i * dim, (i + 1) * dim)

self.onmessage = async (e: MessageEvent<EmbedIn>) => {
  const { model, device, texts } = e.data
  setAuditProbes(texts)
  try {
    const t0 = performance.now()
    const pipe = await load(model, device)
    const loadMs = Math.round(performance.now() - t0)
    const inputs = prep(model, texts)

    if (e.data.type === 'embed') {
      const t1 = performance.now()
      const { dim } = await embedAll(pipe, inputs, (done) => post({ type: 'progress', done, total: inputs.length }))
      post({ type: 'done', loadMs, embedMs: Math.round(performance.now() - t1), count: texts.length, dim, net: allRecords() })
      return
    }

    // classify: 예시 발화 + 사용자 발화를 모두 임베딩한 뒤 B·C·D 세 방식으로 예측
    const t1 = performance.now()
    const seeds = await embedAll(pipe, prep(model, SEED_TEXTS))
    const seedVecs = SEED_TYPES.map((_, i) => row(seeds.data, seeds.dim, i))
    const extra = labeledFor(model) // 이 모델로 만든 라벨 데이터(합·선형 가중치)가 있을 때만 쓴다
    const clf = new TaskClassifier(seedVecs, SEED_TYPES, undefined, extra)
    const { data, dim } = await embedAll(pipe, inputs, (done) => post({ type: 'progress', done, total: inputs.length }))
    const centroid: Prediction[] = []
    const knn: Prediction[] = []
    const linear: Prediction[] = []
    for (let i = 0; i < texts.length; i++) {
      const v = row(data, dim, i)
      centroid.push(clf.centroid(v))
      knn.push(clf.knn(v))
      linear.push(clf.linear(v))
    }
    // 반복 지시 의심 탐지: 귀무분포(서로 다른 대화 무작위 쌍) 상위 1%를 경계로, 같은 대화의 앞선 발화와 비교
    const dIn: DetectInput[] = e.data.inputs.map((u, i) => ({ ...u, taskType: linear[i].type })) // 제품 기본 분류는 D(선형)
    // 경계: 같은 대화 비인접 쌍 분포의 p90(주제 연속 발화의 기본 유사도). 반복 표지가 있는 지시는 다른 대화 쌍 p90만 넘으면 구제.
    const crossSims = nullDistribution(dIn, (i) => row(data, dim, i))
    const withinSims = withinConversationNull(dIn, (i) => row(data, dim, i))
    const nullThreshold = withinSims.length >= 20 ? quantile(withinSims, 0.9) : quantile(crossSims, 0.99)
    // 묶음(앱/Claude Code)별 기준: 그 묶음의 같은 대화 비인접 쌍이 20개 이상이면 그 p90, 아니면 전체 기준
    const groupThreshold: Record<string, number> = {}
    for (const g of new Set(dIn.map((u) => u.group).filter((g): g is string => g != null))) {
      const ids = dIn.map((_, i) => i).filter((i) => dIn[i].group === g)
      const ws = withinConversationNull(ids.map((i) => dIn[i]), (k) => row(data, dim, ids[k]))
      if (ws.length >= 20) groupThreshold[g] = quantile(ws, 0.9)
    }
    const pairs = detect(dIn, (i) => row(data, dim, i), { ...DEFAULT_OPTIONS, nullThreshold, groupThreshold, markerFloor: quantile(crossSims, 0.9) })
    const nullSims = withinSims.length >= 20 ? withinSims : crossSims
    post(
      {
        type: 'classified',
        centroid,
        knn,
        linear,
        embeddings: data,
        dim,
        embedMs: Math.round(performance.now() - t1),
        candidates: pairs.filter((c) => c.grade),
        pairs,
        sims: pairs.map((c) => c.similarity),
        nullSims,
        detectSummary: summarize(pairs, dIn, nullThreshold, groupThreshold),
        modelVersion: `${model}@q8/${device}`,
        classifierVersion: `${CLASSIFIER_VERSION}+${SEED_VERSION}${extra ? '+' + extra.version : ''}`,
        detectorVersion: DETECTOR_VERSION,
        net: allRecords(),
      },
      [data.buffer],
    )
  } catch (err) {
    post({ type: 'error', message: (err as Error).message })
  }
}
