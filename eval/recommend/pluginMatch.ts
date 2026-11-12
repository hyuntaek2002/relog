// 내 대화에 맞춘 플러그인: 대화마다 내 메시지 임베딩 평균을 내고, 플러그인 설명 임베딩(정적 파일, int8)과 비교한다.
// 어떤 메시지와도 비슷하게 나오는 범용 플러그인이 늘 1위가 되지 않게, 플러그인마다 평소 유사도(m·d, 공개 표본 기준)로 표준화한 점수를 쓴다.
// 평가 전용(제품에는 넣지 않음, docs/measurements.md 2026-11-12). 실제 기록에서 후보끼리 유사도 차이가 작아 맞춤 선택이 자주 빗나갔다.
export interface MatchMeta { n: string; m: number; d: number }
export interface ConvMatch { conversationId: string; plugin: number; z: number; sim: number }
export const Q_SCALE = 0.25 / 127 // build_plugin_vecs.mjs의 int8 양자화 배율

// 대화별 내 메시지 임베딩 평균(정규화)
export function convCentroids(ids: string[], vec: (i: number) => Float32Array, dim: number): Map<string, Float32Array> {
  const sums = new Map<string, Float32Array>()
  ids.forEach((c, i) => {
    let s = sums.get(c)
    if (!s) sums.set(c, (s = new Float32Array(dim)))
    const v = vec(i)
    for (let k = 0; k < dim; k++) s[k] += v[k]
  })
  for (const s of sums.values()) {
    let n = 0
    for (let k = 0; k < dim; k++) n += s[k] * s[k]
    n = Math.sqrt(n) || 1
    for (let k = 0; k < dim; k++) s[k] /= n
  }
  return sums
}

// 한 대화의 가장 맞는 플러그인. useZ=false면 원래 코사인(비교용)
export function bestPlugin(q: Float32Array, vecs: Int8Array, meta: MatchMeta[], useZ = true): { plugin: number; z: number; sim: number } {
  const dim = q.length
  let best = -1, bestScore = -Infinity, bestSim = 0, bestZ = 0
  for (let p = 0; p < meta.length; p++) {
    let d = 0
    const o = p * dim
    for (let k = 0; k < dim; k++) d += q[k] * vecs[o + k]
    const sim = d * Q_SCALE
    const z = (sim - meta[p].m) / meta[p].d
    const score = useZ ? z : sim
    if (score > bestScore) { bestScore = score; best = p; bestSim = sim; bestZ = z }
  }
  return { plugin: best, z: bestZ, sim: bestSim }
}

// 정해 둔 후보(목록 위치 idxs) 안에서 가장 맞는 것. 후보가 없으면 null
export function bestAmong(q: Float32Array, vecs: Int8Array, meta: MatchMeta[], idxs: number[]): { plugin: number; z: number } | null {
  const dim = q.length
  let best: { plugin: number; z: number } | null = null
  for (const p of idxs) {
    let d = 0
    for (let k = 0; k < dim; k++) d += q[k] * vecs[p * dim + k]
    const z = (d * Q_SCALE - meta[p].m) / meta[p].d
    if (!best || z > best.z) best = { plugin: p, z }
  }
  return best
}

export function matchConversations(centroids: Map<string, Float32Array>, vecs: Int8Array, meta: MatchMeta[], useZ = true): ConvMatch[] {
  return [...centroids].map(([conversationId, q]) => ({ conversationId, ...bestPlugin(q, vecs, meta, useZ) }))
}
