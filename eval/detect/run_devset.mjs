// 합성 개발셋으로 반복 지시 의심 탐지 규칙을 평가한다. 브라우저와 같은 TS 모듈을 Node에서 그대로 쓴다.
// 사용: node eval/detect/run_devset.mjs [model]   (기본 Xenova/multilingual-e5-small)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from '../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'
import { normalizeText } from '../../web/src/parser/normalize.ts'
import { DEFAULT_OPTIONS, detect, nullDistribution, quantile, withinConversationNull } from '../../web/src/detect/detector.ts'

const here = dirname(fileURLToPath(import.meta.url))
const model = process.argv[2] ?? 'Xenova/multilingual-e5-small'
const dev = JSON.parse(readFileSync(join(here, 'devset.json'), 'utf8'))

// 개발셋 → DetectInput (브라우저 파이프라인과 같은 정규화·prevAssistantIdx 규칙)
const inputs = []
const gold = new Map() // messageId → { gold, tag, scenario }
for (const c of dev.conversations) {
  let t = 0
  let prevAssistantIdx = -1
  c.turns.forEach((turn, idx) => {
    t += turn.minutes ?? 0
    if (turn.role !== 'user') { prevAssistantIdx = idx; return }
    const id = `${c.id}:${idx}`
    inputs.push({ conversationId: c.id, messageId: id, idx, createdAt: t * 60000, text: normalizeText(turn.text).text, tokenEstimate: 10, hasAttachment: !!turn.hasAttachment, prevAssistantIdx })
    if (turn.gold) gold.set(id, { gold: turn.gold, tag: turn.tag, scenario: c.scenario })
  })
}
console.log(`model=${model} utterances=${inputs.length} labeled=${gold.size} repeat=${[...gold.values()].filter((g) => g.gold === 'repeat').length}`)

const t0 = performance.now()
let data, dim
if (model === 'static-e5') {
  // 정적 표(web/public/static-e5)를 디스크에서 읽는다. 브라우저와 같은 모듈.
  const { StaticEmbedder } = await import('../../web/src/classify/staticEmbed.ts')
  const dir = join(here, '../../web/public/static-e5')
  const se = await StaticEmbedder.load(async (name) => { const b = readFileSync(join(dir, name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) })
  const r = await se.embed(inputs.map((u) => u.text))
  data = r.data; dim = r.dim
} else {
  const pipe = await pipeline('feature-extraction', model, { dtype: 'q8' })
  const texts = model.includes('e5') ? inputs.map((u) => 'query: ' + u.text) : inputs.map((u) => u.text)
  const out = await pipe(texts, { pooling: 'mean', normalize: true })
  dim = out.dims[1]
  data = out.data
}
console.log(`embedded in ${Math.round(performance.now() - t0)}ms, dim=${dim}`)
const row = (d) => (i) => d.subarray(i * dim, (i + 1) * dim)

// 중심화: 평균 벡터를 빼고 다시 정규화 → 유사도 분포를 펼친다
function centered(d) {
  const n = inputs.length
  const mean = new Float32Array(dim)
  for (let i = 0; i < n; i++) for (let k = 0; k < dim; k++) mean[k] += d[i * dim + k] / n
  const c = new Float32Array(d.length)
  for (let i = 0; i < n; i++) {
    let norm = 0
    for (let k = 0; k < dim; k++) { c[i * dim + k] = d[i * dim + k] - mean[k]; norm += c[i * dim + k] ** 2 }
    norm = Math.sqrt(norm) || 1
    for (let k = 0; k < dim; k++) c[i * dim + k] /= norm
  }
  return c
}

const withinNull = (vec) => withinConversationNull(inputs, vec)

function evaluate(name, vec, nullThreshold, extra = {}) {
  const pairs = detect(inputs, vec, { ...DEFAULT_OPTIONS, nullThreshold, ...extra })
  let tp = 0, fp = 0, fn = 0
  const misses = [], alarms = []
  const byGrade = { low: 0, medium: 0, high: 0 }
  for (const p of pairs) {
    const g = gold.get(p.messageId)
    if (!g) continue
    const pred = !!p.grade
    if (pred) byGrade[p.grade]++
    if (pred && g.gold === 'repeat') tp++
    else if (pred && g.gold === 'normal') { fp++; alarms.push(`${g.tag}(${p.grade},${p.similarity.toFixed(2)})`) }
    else if (!pred && g.gold === 'repeat') { fn++; misses.push(`${g.tag}(${p.exclusion},${p.similarity.toFixed(2)})`) }
  }
  const P = tp / Math.max(1, tp + fp), R = tp / Math.max(1, tp + fn), F1 = (2 * P * R) / Math.max(1e-9, P + R)
  console.log(`\n== ${name}  threshold=${nullThreshold.toFixed(3)}  P=${P.toFixed(2)} R=${R.toFixed(2)} F1=${F1.toFixed(2)}  tp=${tp} fp=${fp} fn=${fn}  grades=${JSON.stringify(byGrade)}`)
  if (misses.length) console.log('  miss :', misses.join(' '))
  if (alarms.length) console.log('  alarm:', alarms.join(' '))
  return { name, P, R, F1 }
}

const results = []
for (const [label, d] of [['raw', data], ['centered', centered(data)]]) {
  const vec = row(d)
  const cross = nullDistribution(inputs, vec)
  const within = withinNull(vec)
  console.log(`\n### ${label}: cross-conv null p50=${quantile(cross, 0.5).toFixed(3)} p99=${quantile(cross, 0.99).toFixed(3)} | within-conv non-adjacent p50=${quantile(within, 0.5).toFixed(3)} p90=${quantile(within, 0.9).toFixed(3)} p95=${quantile(within, 0.95).toFixed(3)}`)
  const floor = quantile(cross, 0.9) // 표지 구제 하한: 다른 대화 쌍의 p90
  results.push(evaluate(`${label} / cross p99`, vec, quantile(cross, 0.99)))
  results.push(evaluate(`${label} / cross p99 + marker rescue`, vec, quantile(cross, 0.99), { markerFloor: floor }))
  results.push(evaluate(`${label} / within p90`, vec, quantile(within, 0.9)))
  results.push(evaluate(`${label} / within p90 + marker rescue`, vec, quantile(within, 0.9), { markerFloor: floor }))
  results.push(evaluate(`${label} / within p95`, vec, quantile(within, 0.95)))
  results.push(evaluate(`${label} / within p95 + marker rescue`, vec, quantile(within, 0.95), { markerFloor: floor }))
  for (const abs of label === 'raw' ? [0.93] : [0.5]) results.push(evaluate(`${label} / abs ${abs} + marker rescue`, vec, abs, { markerFloor: floor }))
}
console.log('\n=== summary (F1 desc) ===')
for (const r of results.sort((a, b) => b.F1 - a.F1)) console.log(`${r.F1.toFixed(2)}  P=${r.P.toFixed(2)} R=${r.R.toFixed(2)}  ${r.name}`)
