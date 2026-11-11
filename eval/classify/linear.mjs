// D: 임베딩 + 소프트맥스 선형 분류기 학습. 비교 실험(run_abc.mjs)과 제품용 가중치 만들기(build_centroids.mjs)가 같이 쓴다.
// 입력은 L2 정규화된 임베딩. 학습 평균을 빼고 scale을 곱해 학습한 뒤, 그 변환을 가중치에 접어 넣어
// 예측은 "점수 = b + W·v"(v는 원래 임베딩)로 끝나게 한다. 0에서 시작하는 전체 배치 경사 하강이라 결과가 결정적이다.
// 유형별 건수 차이가 커서(기획 5건, 학습 100건 이상) 유형 가중치를 건수의 역수로 준다.
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

export function trainLinear(X, y, { l2 = 1e-2, iters = 400, lr = 1, scale = 10 } = {}) {
  const dim = X[0].length
  const classes = [...new Set(y)]
  const mean = new Float64Array(dim)
  for (const v of X) for (let d = 0; d < dim; d++) mean[d] += v[d] / X.length
  const Xs = X.map((v) => Float64Array.from(v, (x, d) => (x - mean[d]) * scale))
  const yi = y.map((c) => classes.indexOf(c))
  const cnt = classes.map((_, k) => yi.filter((q) => q === k).length)
  const w = yi.map((k) => 1 / (classes.length * cnt[k])) // 합 1
  const W = classes.map(() => new Float64Array(dim)), b = new Float64Array(classes.length)
  for (let it = 0; it < iters; it++) {
    const gW = classes.map(() => new Float64Array(dim)), gb = new Float64Array(classes.length)
    for (let i = 0; i < Xs.length; i++) {
      const z = classes.map((_, k) => b[k] + dot(W[k], Xs[i]))
      const mx = Math.max(...z)
      let Z = 0
      for (let k = 0; k < z.length; k++) { z[k] = Math.exp(z[k] - mx); Z += z[k] }
      for (let k = 0; k < z.length; k++) {
        const g = (z[k] / Z - (k === yi[i] ? 1 : 0)) * w[i]
        gb[k] += g
        for (let d = 0; d < dim; d++) gW[k][d] += g * Xs[i][d]
      }
    }
    for (let k = 0; k < classes.length; k++) { b[k] -= lr * gb[k]; for (let d = 0; d < dim; d++) W[k][d] -= lr * (gW[k][d] + l2 * W[k][d]) }
  }
  // 변환 접기: b + W·((v - mean)·scale) = (b - scale·W·mean) + (scale·W)·v
  return { classes, W: W.map((r) => Array.from(r, (x) => x * scale)), b: classes.map((_, k) => b[k] - scale * dot(W[k], mean)) }
}

export function predictLinear(m, v) {
  let best = 0, bs = -Infinity
  for (let k = 0; k < m.classes.length; k++) { const s = m.b[k] + dot(m.W[k], v); if (s > bs) { bs = s; best = k } }
  return m.classes[best]
}
