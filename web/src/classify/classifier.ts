import seed from './seed.json' with { type: 'json' }
import labeled from './labeled-centroids.json' with { type: 'json' }

// 0.2.0: 제품 기본을 C(k-NN, 예시만)에서 B(중심점, 예시 + 라벨 데이터 합)로 바꿈.
// 근거(docs/measurements.md 2026-11-11): 공개 표본 395건 5겹 교차 검증 Macro F1이 C·예시만 0.357, B·예시+학습 0.451.
export const CLASSIFIER_VERSION = 'cls-0.2.0'
// 라벨된 공개 표본의 유형별 임베딩 합(원문 없음). 이 합을 만든 모델로 임베딩했을 때만 쓴다.
export const LABELED: { version: string; model: string; dim: number; counts: Record<string, number>; sums: Record<string, number[]> } = labeled
export const labeledFor = (model: string) => (model === LABELED.model ? LABELED : undefined)

export type TaskType = keyof typeof seed.types
export const TASK_TYPES = Object.keys(seed.types) as TaskType[]
export const TASK_LABELS = Object.fromEntries(TASK_TYPES.map((t) => [t, seed.types[t].label])) as Record<TaskType, string>
export const SEED_VERSION = seed.version

// 예시 발화를 평탄화. 임베딩은 호출 측에서 같은 순서로 만든다.
export const SEED_TEXTS: string[] = TASK_TYPES.flatMap((t) => seed.types[t].examples)
export const SEED_TYPES: TaskType[] = TASK_TYPES.flatMap((t) => seed.types[t].examples.map(() => t))

export type Method = 'centroid' | 'knn'
export interface Prediction { type: TaskType | 'other'; score: number }

// 모든 벡터는 L2 정규화돼 있다고 가정 → 코사인 = 내적
export const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export class TaskClassifier {
  private centroids: Map<TaskType, Float32Array>
  private seedVecs: Float32Array[]
  private seedTypes: TaskType[]
  private opts: { k: number; otherBelow: number }
  // extra: 유형별 임베딩 합(라벨 데이터). 예시 발화의 합에 더한 뒤 정규화해 중심점을 만든다. k-NN에는 영향을 주지 않는다.
  constructor(seedVecs: Float32Array[], seedTypes: TaskType[], opts = { k: 5, otherBelow: 0.0 }, extra?: { sums: Record<string, number[]> }) {
    this.seedVecs = seedVecs
    this.seedTypes = seedTypes
    this.opts = opts
    this.centroids = new Map()
    for (const t of new Set(seedTypes)) {
      const idx = seedTypes.map((s, i) => (s === t ? i : -1)).filter((i) => i >= 0)
      const dim = seedVecs[0].length
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
  centroid(v: Float32Array): Prediction {
    let best: TaskType | null = null
    let bestS = -Infinity
    for (const [t, c] of this.centroids) {
      const s = dot(v, c)
      if (s > bestS) { bestS = s; best = t }
    }
    return bestS < this.opts.otherBelow || !best ? { type: 'other', score: bestS } : { type: best, score: bestS }
  }

  // C: k-NN, 유사도 가중 투표
  knn(v: Float32Array): Prediction {
    const sims = this.seedVecs.map((s, i) => ({ s: dot(v, s), t: this.seedTypes[i] }))
    sims.sort((a, b) => b.s - a.s)
    const votes = new Map<TaskType, number>()
    for (const { s, t } of sims.slice(0, this.opts.k)) votes.set(t, (votes.get(t) ?? 0) + s)
    let best: TaskType | null = null
    let bestV = -Infinity
    for (const [t, vv] of votes) if (vv > bestV) { bestV = vv; best = t }
    const top = sims[0].s
    return top < this.opts.otherBelow || !best ? { type: 'other', score: top } : { type: best, score: top }
  }

  predict(v: Float32Array, method: Method): Prediction {
    return method === 'centroid' ? this.centroid(v) : this.knn(v)
  }
}
