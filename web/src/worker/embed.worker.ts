import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { CLASSIFIER_VERSION, SEED_TEXTS, SEED_TYPES, SEED_VERSION, TaskClassifier, type Prediction } from '../classify/classifier.ts'

// 모델은 1회 다운로드 후 Cache Storage에 캐시된다(transformers.js 기본 동작).
env.allowLocalModels = false

// 배치 안에서 가장 긴 문장 길이로 패딩되므로 작은 배치 + 길이순 정렬.
const BATCH = 16

export type EmbedIn =
  | { type: 'embed'; model: string; device: 'wasm' | 'webgpu'; texts: string[] } // 속도 측정용
  | { type: 'classify'; model: string; device: 'wasm' | 'webgpu'; texts: string[] }
export type EmbedOut =
  | { type: 'download'; file: string; percent: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; loadMs: number; embedMs: number; count: number; dim: number }
  | { type: 'classified'; centroid: Prediction[]; knn: Prediction[]; embeddings: Float32Array; dim: number; embedMs: number; modelVersion: string; classifierVersion: string }
  | { type: 'error'; message: string }

type Pipe = FeatureExtractionPipeline
const post = (m: EmbedOut, transfer: Transferable[] = []) => self.postMessage(m, { transfer })

async function load(model: string, device: 'wasm' | 'webgpu'): Promise<Pipe> {
  return (await pipeline('feature-extraction', model, {
    dtype: 'q8',
    device,
    progress_callback: (p: { status: string; file?: string; progress?: number }) => {
      if (p.status === 'progress' && p.file) post({ type: 'download', file: p.file, percent: Math.round(p.progress ?? 0) })
    },
  })) as Pipe
}

// E5 계열은 "query: " 접두어 필수
const prep = (model: string, texts: string[]) => (model.includes('e5') ? texts.map((t) => 'query: ' + t) : texts)

// 길이순으로 묶어 임베딩하고 원래 순서로 되돌린다. 결과는 (n × dim) 한 덩어리.
async function embedAll(pipe: Pipe, texts: string[], onProgress?: (done: number) => void): Promise<{ data: Float32Array; dim: number }> {
  const order = texts.map((_, i) => i).sort((a, b) => texts[a].length - texts[b].length)
  let data: Float32Array | null = null
  let dim = 0
  for (let i = 0; i < order.length; i += BATCH) {
    const idx = order.slice(i, i + BATCH)
    const out = await pipe(idx.map((j) => texts[j]), { pooling: 'mean', normalize: true })
    dim = out.dims[1]
    data ??= new Float32Array(texts.length * dim)
    const flat = out.data as Float32Array
    idx.forEach((j, r) => data!.set(flat.subarray(r * dim, (r + 1) * dim), j * dim))
    onProgress?.(Math.min(i + BATCH, order.length))
  }
  return { data: data ?? new Float32Array(0), dim }
}

const row = (data: Float32Array, dim: number, i: number) => data.subarray(i * dim, (i + 1) * dim)

self.onmessage = async (e: MessageEvent<EmbedIn>) => {
  const { model, device, texts } = e.data
  try {
    const t0 = performance.now()
    const pipe = await load(model, device)
    const loadMs = Math.round(performance.now() - t0)
    const inputs = prep(model, texts)

    if (e.data.type === 'embed') {
      const t1 = performance.now()
      const { dim } = await embedAll(pipe, inputs, (done) => post({ type: 'progress', done, total: inputs.length }))
      post({ type: 'done', loadMs, embedMs: Math.round(performance.now() - t1), count: texts.length, dim })
      return
    }

    // classify: 예시 발화 + 사용자 발화를 모두 임베딩한 뒤 B·C 두 방식으로 예측
    const t1 = performance.now()
    const seeds = await embedAll(pipe, prep(model, SEED_TEXTS))
    const seedVecs = SEED_TYPES.map((_, i) => row(seeds.data, seeds.dim, i))
    const clf = new TaskClassifier(seedVecs, SEED_TYPES)
    const { data, dim } = await embedAll(pipe, inputs, (done) => post({ type: 'progress', done, total: inputs.length }))
    const centroid: Prediction[] = []
    const knn: Prediction[] = []
    for (let i = 0; i < texts.length; i++) {
      const v = row(data, dim, i)
      centroid.push(clf.centroid(v))
      knn.push(clf.knn(v))
    }
    post(
      { type: 'classified', centroid, knn, embeddings: data, dim, embedMs: Math.round(performance.now() - t1), modelVersion: `${model}@q8/${device}`, classifierVersion: `${CLASSIFIER_VERSION}+${SEED_VERSION}` },
      [data.buffer],
    )
  } catch (err) {
    post({ type: 'error', message: (err as Error).message })
  }
}
