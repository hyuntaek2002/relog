import seed from './seed.json' with { type: 'json' }

export const CLASSIFIER_VERSION = 'cls-0.1.0'

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
  constructor(seedVecs: Float32Array[], seedTypes: TaskType[], opts = { k: 5, otherBelow: 0.0 }) {
    this.seedVecs = seedVecs
    this.seedTypes = seedTypes
    this.opts = opts
    this.centroids = new Map()
    for (const t of new Set(seedTypes)) {
      const idx = seedTypes.map((s, i) => (s === t ? i : -1)).filter((i) => i >= 0)
      const dim = seedVecs[0].length
      const c = new Float32Array(dim)
      for (const i of idx) for (let d = 0; d < dim; d++) c[d] += seedVecs[i][d]
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
