import seed from './seed.json' with { type: 'json' }
import labeled from './labeled-centroids.json' with { type: 'json' }
import labeledSmall from './labeled-centroids-small.json' with { type: 'json' }

// 0.2.0: 제품 기본을 C(k-NN, 예시만)에서 B(중심점, 예시 + 라벨 데이터 합)로 바꿈.
// 근거(docs/measurements.md 2026-11-11): 공개 표본 395건 5겹 교차 검증 Macro F1이 C·예시만 0.357, B·예시+학습 0.451.
// 0.3.0: 제품 기본을 D(임베딩 + 선형, 예시 + 라벨 데이터로 학습)로 바꾸고, 기타도 한 유형으로 배운다(B에는 기타 중심점 추가).
// 근거(docs/measurements.md 2026-11-11 "분류 개선"): 같은 5겹 교차 검증에서 B 0.451 → B+기타 0.488 → D 0.518(정확도 0.539 → 0.628).
// 0.4.0: D 확률에 같은 대화의 나머지 메시지 확률 평균을 CONTEXT_WEIGHT배 더해 고른다(문맥). 임베딩 모델은 e5-large로 바꿈(labeled-0.4.0).
// 근거(docs/measurements.md 2026-11-17 "같은 대화 문맥 섞기"): e5-large + 문맥이 공개 표본 F1 0.655 · 본인 라벨 정확도 0.665로 가장 높음.
// 0.5.0: 화면·추천의 대화 종류를 8가지에서 6가지로 합침(업무 문서 → 글·문서, 정보 탐색 → 정보·학습). 라벨을 붙이는 사람도 경계가 헷갈렸던 두 쌍.
//   모델은 지금처럼 8가지로 학습·예측하고, 고른 결과만 합친다(toTask). 6가지로 다시 학습하면 공개 표본 정확도가 0.747 → 0.716으로 더 낮았다.
// 근거(docs/measurements.md 2026-11-18 "대화 종류 합치기"): 본인 라벨 정확도 0.665 → 0.711, 공개 표본 0.719 → 0.747.
export const CLASSIFIER_VERSION = 'cls-0.5.0'
export const CONTEXT_WEIGHT = 0.5
// 라벨된 공개 표본의 유형별 임베딩 합과 선형 분류기 가중치(원문 없음). 이 파일을 만든 모델로 임베딩했을 때만 쓴다.
export interface LinearModel { classes: string[]; W: number[][]; b: number[] } // 점수 = b[k] + W[k]·v
type Labeled = { version: string; model: string; dim: number; counts: Record<string, number>; sums: Record<string, number[]>; linear?: LinearModel }
export const LABELED: Labeled = labeled // 제품 기본(정밀 분석, e5-large)
// 빠른 분석(e5-small)용: 같은 라벨 표본(공개 395 + 보강 67건)을 e5-small로 임베딩해 학습한 것(2026-11-18 다시 만듦)
const LABELED_LIST: Labeled[] = [LABELED, labeledSmall]
export const labeledFor = (model: string) => LABELED_LIST.find((l) => l.model === model)

// 모델이 배우는 세부 종류(예시 발화·라벨 CSV와 같은 8가지)
export type FineType = keyof typeof seed.types
export const FINE_TYPES = Object.keys(seed.types) as FineType[]
// 화면·추천·기록에 쓰는 대화 종류 6가지
export const TASK_TYPES = ['coding', 'writing', 'learning', 'ideation', 'translation', 'chat'] as const
export type TaskType = (typeof TASK_TYPES)[number]
export const TASK_LABELS: Record<TaskType, string> = { coding: '코딩', writing: '글·문서', learning: '정보·학습', ideation: '아이디어·기획', translation: '번역', chat: '상담·대화' }
// 세부 종류 → 대화 종류. 예전 기록(8가지 키)을 읽을 때도 쓴다.
export const MERGED_TYPES: Record<string, TaskType> = { work_doc: 'writing', search: 'learning' }
export const foldTask = (t: string): string => MERGED_TYPES[t] ?? t
export const SEED_VERSION = seed.version

// 예시 발화를 평탄화. 임베딩은 호출 측에서 같은 순서로 만든다.
export const SEED_TEXTS: string[] = FINE_TYPES.flatMap((t) => seed.types[t].examples)
export const SEED_TYPES: FineType[] = FINE_TYPES.flatMap((t) => seed.types[t].examples.map(() => t))

export type Method = 'centroid' | 'knn' | 'linear'
export interface Prediction { type: TaskType | 'other'; score: number }
export interface FinePrediction { type: FineType | 'other'; score: number } // 모델이 고른 세부 종류
export const toTask = (p: FinePrediction): Prediction => ({ type: foldTask(p.type) as TaskType | 'other', score: p.score })

// 모든 벡터는 L2 정규화돼 있다고 가정 → 코사인 = 내적
export const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export class TaskClassifier {
  private centroids: Map<FineType | 'other', Float32Array>
  private seedVecs: Float32Array[]
  private seedTypes: FineType[]
  private opts: { k: number; otherBelow: number }
  private lin?: LinearModel
  // extra.sums: 유형별 임베딩 합(라벨 데이터). 예시 발화의 합에 더한 뒤 정규화해 중심점을 만든다. 예시가 없는 기타는 이 합만으로 중심점이 생긴다. k-NN에는 영향을 주지 않는다.
  // extra.linear: 선형 분류기 가중치. 차원이 맞을 때만 쓴다.
  constructor(seedVecs: Float32Array[], seedTypes: FineType[], opts = { k: 5, otherBelow: 0.0 }, extra?: { sums: Record<string, number[]>; linear?: LinearModel }) {
    this.seedVecs = seedVecs
    this.seedTypes = seedTypes
    this.opts = opts
    this.centroids = new Map()
    const dim = seedVecs[0].length
    if (extra?.linear?.W.every((r) => r.length === dim)) this.lin = extra.linear
    const other = extra?.sums.other?.length === dim ? (['other'] as const) : []
    for (const t of [...new Set(seedTypes), ...other]) {
      const idx = seedTypes.map((s, i) => (s === t ? i : -1)).filter((i) => i >= 0)
      const c = new Float32Array(dim)
      for (const i of idx) for (let d = 0; d < dim; d++) c[d] += seedVecs[i][d]
      const add = extra?.sums[t]
      if (add && add.length === dim) for (let d = 0; d < dim; d++) c[d] += add[d]
      let n = 0
      for (let d = 0; d < dim; d++) n += c[d] * c[d]
      n = Math.sqrt(n) || 1
      for (let d = 0; d < dim; d++) c[d] /= n
      this.centroids.set(t, c)
    }
  }

  // B: 유형별 중심점과의 코사인 유사도 최대
  centroid(v: Float32Array): FinePrediction {
    let best: FineType | 'other' | null = null
    let bestS = -Infinity
    for (const [t, c] of this.centroids) {
      const s = dot(v, c)
      if (s > bestS) { bestS = s; best = t }
    }
    return bestS < this.opts.otherBelow || !best ? { type: 'other', score: bestS } : { type: best, score: bestS }
  }

  // C: k-NN, 유사도 가중 투표
  knn(v: Float32Array): FinePrediction {
    const sims = this.seedVecs.map((s, i) => ({ s: dot(v, s), t: this.seedTypes[i] }))
    sims.sort((a, b) => b.s - a.s)
    const votes = new Map<FineType, number>()
    for (const { s, t } of sims.slice(0, this.opts.k)) votes.set(t, (votes.get(t) ?? 0) + s)
    let best: FineType | null = null
    let bestV = -Infinity
    for (const [t, vv] of votes) if (vv > bestV) { bestV = vv; best = t }
    const top = sims[0].s
    return top < this.opts.otherBelow || !best ? { type: 'other', score: top } : { type: best, score: top }
  }

  // D: 선형 분류기. 점수는 소프트맥스 확률. 가중치가 없으면(다른 임베딩 모델) B로 대신한다.
  linear(v: Float32Array): FinePrediction {
    const m = this.lin
    if (!m) return this.centroid(v)
    const z = m.b.map((b, k) => { let s = b; for (let d = 0; d < v.length; d++) s += m.W[k][d] * v[d]; return s })
    const mx = Math.max(...z)
    const best = z.indexOf(mx)
    return { type: m.classes[best] as FineType | 'other', score: 1 / z.reduce((a, x) => a + Math.exp(x - mx), 0) }
  }

  // D의 유형별 소프트맥스 확률(가중치가 없으면 null)
  linearProbs(v: Float32Array): { classes: string[]; p: number[] } | null {
    const m = this.lin
    if (!m) return null
    const z = m.b.map((b, k) => { let s = b; for (let d = 0; d < v.length; d++) s += m.W[k][d] * v[d]; return s })
    const mx = Math.max(...z), e = z.map((x) => Math.exp(x - mx)), Z = e.reduce((a, x) => a + x, 0)
    return { classes: m.classes, p: e.map((x) => x / Z) }
  }

  predict(v: Float32Array, method: Method): FinePrediction {
    return method === 'centroid' ? this.centroid(v) : method === 'knn' ? this.knn(v) : this.linear(v)
  }
}

// D + 문맥: 각 메시지 확률에 같은 대화 나머지 메시지의 평균 확률을 lam배 더해 고른다. 대화에 메시지가 하나뿐이면 D와 같다.
export function linearWithContext(clf: TaskClassifier, vecs: Float32Array[], convIds: string[], lam = CONTEXT_WEIGHT): FinePrediction[] {
  const ps = vecs.map((v) => clf.linearProbs(v))
  if (ps.some((p) => !p)) return vecs.map((v) => clf.linear(v)) // 가중치 없음 → B로 대신
  const sum = new Map<string, number[]>(), cnt = new Map<string, number>()
  ps.forEach((p, i) => {
    const s = sum.get(convIds[i]) ?? p!.p.map(() => 0)
    p!.p.forEach((x, k) => (s[k] += x))
    sum.set(convIds[i], s); cnt.set(convIds[i], (cnt.get(convIds[i]) ?? 0) + 1)
  })
  return ps.map((p, i) => {
    const n = cnt.get(convIds[i])!, s = sum.get(convIds[i])!
    const q = p!.p.map((x, k) => x + (n > 1 ? (lam * (s[k] - x)) / (n - 1) : 0))
    const best = q.indexOf(Math.max(...q))
    return { type: p!.classes[best] as FineType | 'other', score: q[best] / q.reduce((a, x) => a + x, 0) }
  })
}
