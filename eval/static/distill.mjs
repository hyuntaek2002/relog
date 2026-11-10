// e5-small에서 정적(토큰 평균) 임베딩 테이블을 증류한다. Model2Vec 방식의 축소판:
//   어휘의 각 토큰을 모델에 한 번씩 통과 → 토큰 벡터 → 평균 제거 → PCA 축소 → Zipf 가중 → int8 양자화.
// 결과는 web/public/static-e5/ 에 저장되고, 브라우저에서는 토크나이저 + 표 조회 + 평균만으로 임베딩한다.
// 사용: node eval/static/distill.mjs [dims=128] [model=Xenova/multilingual-e5-small]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AutoTokenizer, pipeline } from '../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'

const DIMS = Number(process.argv[2] ?? 128)
const MODEL = process.argv[3] ?? 'Xenova/multilingual-e5-small'
const out = join(dirname(fileURLToPath(import.meta.url)), '../../web/public/static-e5')
mkdirSync(out, { recursive: true })

const tok = await AutoTokenizer.from_pretrained(MODEL)
const vocab = (tok.model ?? tok._tokenizer.model).vocab // id → 토큰 문자열(sentencepiece '▁' 포함)
console.log(`vocab=${vocab.length}`)

// 어휘 필터: 한글·라틴·숫자·기본 구두점으로만 된 토큰. 다른 문자 체계는 이 서비스 대상이 아니라 뺀다(표 크기 1/3).
const keep = []
for (let id = 0; id < vocab.length; id++) {
  const t = vocab[id].replace(/^▁/, '')
  if (!t) continue
  if (/^[\p{Script=Hangul}\p{Script=Latin}\p{Nd}\p{P}\p{S}]+$/u.test(t)) keep.push(id)
}
console.log(`kept=${keep.length}`)

const pipe = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
const prefix = MODEL.includes('e5') ? 'query: ' : ''
const B = 128
const raw = new Float32Array(keep.length * 384)
const t0 = performance.now()
for (let i = 0; i < keep.length; i += B) {
  const ids = keep.slice(i, i + B)
  const texts = ids.map((id) => prefix + vocab[id].replace(/^▁/, ' ').trim())
  const o = await pipe(texts, { pooling: 'mean', normalize: true })
  raw.set(o.data, i * 384)
  if ((i / B) % 50 === 0) console.log(`${i}/${keep.length} ${Math.round((performance.now() - t0) / 1000)}s`)
}
console.log(`embedded in ${Math.round((performance.now() - t0) / 1000)}s`)

// 평균 제거 + PCA(공분산 384×384, 멱반복으로 상위 DIMS 고유벡터)
const n = keep.length, d = 384
const mean = new Float64Array(d)
for (let i = 0; i < n; i++) for (let k = 0; k < d; k++) mean[k] += raw[i * d + k] / n
const cov = new Float64Array(d * d)
for (let i = 0; i < n; i++) for (let a = 0; a < d; a++) { const xa = raw[i * d + a] - mean[a]; if (!xa) continue; for (let b = a; b < d; b++) cov[a * d + b] += xa * (raw[i * d + b] - mean[b]) }
for (let a = 0; a < d; a++) for (let b = 0; b < a; b++) cov[a * d + b] = cov[b * d + a]
const comps = []
const work = Float64Array.from(cov)
for (let c = 0; c < DIMS; c++) {
  let v = new Float64Array(d).map(() => Math.random() - 0.5)
  for (let it = 0; it < 60; it++) {
    const nv = new Float64Array(d)
    for (let a = 0; a < d; a++) { let s = 0; for (let b = 0; b < d; b++) s += work[a * d + b] * v[b]; nv[a] = s }
    const norm = Math.hypot(...nv) || 1
    v = nv.map((x) => x / norm)
  }
  let lambda = 0
  for (let a = 0; a < d; a++) { let s = 0; for (let b = 0; b < d; b++) s += work[a * d + b] * v[b]; lambda += v[a] * s }
  for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) work[a * d + b] -= lambda * v[a] * v[b] // 수축
  comps.push(v)
}
console.log('pca done')

// 투영 + Zipf 가중(어휘 id 순서를 빈도 순위로 근사: sentencepiece는 대체로 빈도순) + int8 양자화(행별 스케일)
const q = new Int8Array(n * DIMS)
const scale = new Float32Array(n)
for (let i = 0; i < n; i++) {
  const w = 1 / Math.log(2 + keep[i])
  const proj = new Float64Array(DIMS)
  let mx = 0
  for (let c = 0; c < DIMS; c++) { let s = 0; for (let k = 0; k < d; k++) s += (raw[i * d + k] - mean[k]) * comps[c][k]; proj[c] = s * w; mx = Math.max(mx, Math.abs(s * w)) }
  scale[i] = mx / 127 || 1
  for (let c = 0; c < DIMS; c++) q[i * DIMS + c] = Math.round(proj[c] / scale[i])
}
writeFileSync(join(out, 'vectors.i8'), Buffer.from(q.buffer))
writeFileSync(join(out, 'scales.f32'), Buffer.from(scale.buffer))
writeFileSync(join(out, 'ids.json'), JSON.stringify(keep))
writeFileSync(join(out, 'meta.json'), JSON.stringify({ version: 'static-e5-0.1.0', source: MODEL, dims: DIMS, rows: n, builtAt: new Date().toISOString() }))
console.log(`wrote ${out}: vectors ${(q.byteLength / 1048576).toFixed(1)}MB, rows=${n}, dims=${DIMS}`)
