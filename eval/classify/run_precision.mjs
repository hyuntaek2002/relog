// 정밀도 실험: D(임베딩 + 선형) + 업무 문서·기획 보강분에서 ① 비율 보정, ② 확신 낮을 때 보류/2위 대신을 5겹 교차 검증으로 비교한다.
// 분할은 run_abc.mjs --cv와 같다(같은 시드로 대화를 섞고 i % 5). 보강분은 학습에만 더하고 평가는 무작위 표본으로만 한다.
// 사용: node eval/classify/run_precision.mjs <표본 zip> <라벨 CSV> <보강 zip> <보강 CSV> [모델 id] [--dtype=q8]
//   임베딩은 스크래치 캐시(--cache=<경로>)가 있으면 다시 쓴다. 원문은 출력하지 않는다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { unzipSync } from '../../web/node_modules/fflate/esm/index.mjs'
import { pipeline } from '../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'
import { parseConversationsJson } from '../../web/src/parser/chatgpt.ts'
import { normalizeConversations } from '../../web/src/parser/normalize.ts'
import { SEED_TEXTS, SEED_TYPES, FINE_TYPES } from '../../web/src/classify/classifier.ts'
import { trainLinear } from './linear.mjs'

const flag = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const [zip, csv, xzip, xcsv, modelArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const model = modelArg ?? 'Xenova/multilingual-e5-small'
const dtype = flag('dtype') ?? 'q8'
const CLASSES = [...FINE_TYPES, 'other'] // 모델·라벨은 세부 8종
const RARE = ['work_doc', 'ideation']
const ABSTAIN = '(보류)'

function loadItems(zipPath, csvPath) {
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)))
  const convs = Object.entries(files).filter(([n]) => /conversations[^/]*\.json$/i.test(n)).flatMap(([, b]) => parseConversationsJson(JSON.parse(new TextDecoder().decode(b))).conversations)
  const textById = new Map(normalizeConversations(convs).map((u) => [u.messageId, u.text]))
  const out = []
  for (const line of readFileSync(csvPath, 'utf8').split('\n').slice(1)) {
    const [conversationId, messageId, type] = line.trim().split(',')
    if (!messageId || !type || type === 'context_required') continue
    const text = textById.get(messageId)
    if (text) out.push({ conversationId, messageId, text, type })
  }
  return out
}
const items = loadItems(zip, csv), extra = loadItems(xzip, xcsv)

// ---------- 임베딩(캐시) ----------
const cache = flag('cache')
let vecs
if (cache && existsSync(cache)) vecs = JSON.parse(readFileSync(cache, 'utf8'))
else {
  const t0 = Date.now()
  const pipe = await pipeline('feature-extraction', model, { dtype })
  const prep = (t) => (model.includes('e5') ? 'query: ' + t : t)
  const embed = async (texts) => {
    const out = []
    for (let i = 0; i < texts.length; i += 16) {
      const o = await pipe(texts.slice(i, i + 16).map(prep), { pooling: model.includes('bge') ? 'cls' : 'mean', normalize: true })
      const dim = o.dims[1]
      for (let k = 0; k < o.dims[0]; k++) out.push(Array.from(o.data.slice(k * dim, (k + 1) * dim)))
    }
    return out
  }
  vecs = { seed: await embed(SEED_TEXTS), items: await embed(items.map((x) => x.text)), extra: await embed(extra.map((x) => x.text)), ms: Date.now() - t0 }
  if (cache) writeFileSync(cache, JSON.stringify(vecs))
}
console.log(`model=${model} dtype=${dtype} dim=${vecs.items[0].length} items=${items.length} extra=${extra.length} 임베딩 ${Math.round(vecs.ms / 1000)}초`)

// ---------- 분할(run_abc.mjs와 같다) ----------
let seed = 7
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
const convIds = [...new Set(items.map((x) => x.conversationId))]
for (let i = convIds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [convIds[i], convIds[j]] = [convIds[j], convIds[i]] }
const K = 5
const foldOf = new Map(convIds.map((c, i) => [c, i % K]))

// ---------- 지표: 보류는 어느 유형의 예측에도 들어가지 않는다(정밀도 분모 제외, 재현율에선 놓친 것) ----------
function metrics(gold, pred) {
  const rows = {}
  let sp = 0, sr = 0, sf = 0
  for (const c of CLASSES) {
    const tp = gold.filter((g, i) => g === c && pred[i] === c).length
    const np = pred.filter((p) => p === c).length, ng = gold.filter((g) => g === c).length
    const P = np ? tp / np : 0, R = ng ? tp / ng : 0, F = P + R ? (2 * P * R) / (P + R) : 0
    rows[c] = { P, R, F, np }
    sp += P; sr += R; sf += F
  }
  const n = CLASSES.length
  return { P: sp / n, R: sr / n, F: sf / n, acc: gold.filter((g, i) => g === pred[i]).length / gold.length, cover: pred.filter((p) => p !== ABSTAIN).length / pred.length, rows }
}

// ---------- 예측 ----------
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
const probs = (m, v, bias) => {
  const z = m.classes.map((_, k) => m.b[k] + (bias?.[k] ?? 0) + dot(m.W[k], v))
  const mx = Math.max(...z), e = z.map((x) => Math.exp(x - mx)), Z = e.reduce((a, b) => a + b, 0)
  return e.map((x) => x / Z)
}
// 실제 비율(무작위 표본 학습 겹) 기준 절편 보정: alpha·log(사전확률) — 균형 가중치로 배운 모델은 사전확률이 고르다고 가정하므로 이 항을 더하면 실제 비율로 돌아간다
const priorBias = (m, idx, alpha) => {
  const cnt = m.classes.map((c) => idx.filter((i) => items[i].type === c).length + 1) // +1: 0건 방지
  const tot = cnt.reduce((a, b) => a + b, 0)
  return cnt.map((c) => alpha * Math.log(c / tot))
}
function decide(p, classes, rule, tau) {
  const order = p.map((x, k) => [x, k]).sort((a, b) => b[0] - a[0])
  const top = classes[order[0][1]]
  if (rule === 'abstain' && order[0][0] < tau) return ABSTAIN
  if (rule === 'rare2nd' && RARE.includes(top) && order[0][0] < tau) return classes[order[1][1]]
  return top
}

const configs = []
for (const balance of [1, 0.5, 0]) for (const alpha of [0, 0.5, 1]) configs.push({ balance, alpha, rule: 'none', tau: 0 })
const TAUS = [0.4, 0.5, 0.6, 0.7]
for (const tau of TAUS) configs.push({ balance: 1, alpha: 0, rule: 'abstain', tau }, { balance: 1, alpha: 0, rule: 'rare2nd', tau })

const L2 = 1e-2 // run_abc 교차 검증에서 겹마다 대부분 고른 값
const pred = configs.map(() => [])
const models = {}
for (let f = 0; f < K; f++) {
  const tr = items.map((_, i) => i).filter((i) => foldOf.get(items[i].conversationId) !== f)
  const te = items.map((_, i) => i).filter((i) => foldOf.get(items[i].conversationId) === f)
  for (const balance of [1, 0.5, 0]) {
    models[balance] = trainLinear([...vecs.seed, ...tr.map((i) => vecs.items[i]), ...vecs.extra], [...SEED_TYPES, ...tr.map((i) => items[i].type), ...extra.map((x) => x.type)], { l2: L2, balance })
  }
  configs.forEach((c, ci) => {
    const m = models[c.balance]
    const bias = c.alpha ? priorBias(m, tr, c.alpha) : null
    for (const i of te) pred[ci][i] = decide(probs(m, vecs.items[i], bias), m.classes, c.rule, c.tau)
  })
}
// 기준값을 평가 겹을 보지 않고 고르기: 학습 4겹 중 한 겹을 떼어(run_abc와 같은 방식) 그 겹의 macro F1이 가장 높은 (비율 보정, 2위 기준)을 고른 뒤 평가 겹에 쓴다
const nested = []
const picked = []
for (let f = 0; f < K; f++) {
  const tr = items.map((_, i) => i).filter((i) => foldOf.get(items[i].conversationId) !== f)
  const te = items.map((_, i) => i).filter((i) => foldOf.get(items[i].conversationId) === f)
  const inner = (f + 1) % K
  const fit = tr.filter((i) => foldOf.get(items[i].conversationId) !== inner), val = tr.filter((i) => foldOf.get(items[i].conversationId) === inner)
  const train = (idx) => trainLinear([...vecs.seed, ...idx.map((i) => vecs.items[i]), ...vecs.extra], [...SEED_TYPES, ...idx.map((i) => items[i].type), ...extra.map((x) => x.type)], { l2: L2 })
  const mi = train(fit)
  let best = null
  for (const alpha of [0, 0.5, 1]) for (const tau of [0, ...TAUS]) {
    const bias = alpha ? priorBias(mi, fit, alpha) : null
    const m = metrics(val.map((i) => items[i].type), val.map((i) => decide(probs(mi, vecs.items[i], bias), mi.classes, tau ? 'rare2nd' : 'none', tau)))
    if (!best || m.F > best.F) best = { alpha, tau, F: m.F }
  }
  picked.push(`${best.alpha}/${best.tau}`)
  const m = train(tr)
  const bias = best.alpha ? priorBias(m, tr, best.alpha) : null
  for (const i of te) nested[i] = decide(probs(m, vecs.items[i], bias), m.classes, best.tau ? 'rare2nd' : 'none', best.tau)
}
const gold = items.map((x) => x.type)
{
  const m = metrics(gold, nested)
  console.log(`\n[학습 겹 안에서 고른 설정] 겹별 비율 보정/2위 기준: ${picked.join(', ')}`)
  console.log(`macro P ${m.P.toFixed(3)} · R ${m.R.toFixed(3)} · F1 ${m.F.toFixed(3)} · 정확도 ${m.acc.toFixed(3)} · 업무 문서 P/R ${m.rows.work_doc.P.toFixed(2)}/${m.rows.work_doc.R.toFixed(2)} · 기획 P/R ${m.rows.ideation.P.toFixed(2)}/${m.rows.ideation.R.toFixed(2)}`)
}
const name = (c) => c.rule === 'none' ? `가중치 ${c.balance === 1 ? '역수' : c.balance === 0 ? '없음' : '역수^0.5'}, 비율 보정 ${c.alpha}` : c.rule === 'abstain' ? `1위 확률 <${c.tau}이면 보류` : `업무문서·기획 1위 확률 <${c.tau}이면 2위로`
const f2 = (x) => x.toFixed(3)
console.log('\n설정 | macro P | macro R | macro F1 | 정확도 | 판정 비율 | 업무 문서 P/R | 기획 P/R')
configs.forEach((c, ci) => {
  const m = metrics(gold, pred[ci])
  const r = (t) => `${m.rows[t].P.toFixed(2)}/${m.rows[t].R.toFixed(2)}(${m.rows[t].np})`
  console.log(`${name(c)} | ${f2(m.P)} | ${f2(m.R)} | ${f2(m.F)} | ${f2(m.acc)} | ${f2(m.cover)} | ${r('work_doc')} | ${r('ideation')}`)
})
