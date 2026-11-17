// 분류 개선 실험: ① 같은 대화의 다른 메시지 예측을 섞기(문맥), ② TF-IDF(A)와 D 확률 섞기.
// 공개 표본 5겹 교차 검증(run_abc.mjs --cv와 같은 분할, 보강분은 학습에만) + 선택: 외부 라벨(--test-zip/--test-csv)로 평가(학습에는 쓰지 않음).
// 사용: node eval/classify/run_context.mjs <표본 zip> <라벨 CSV> <보강 zip> <보강 CSV> [--test-zip=… --test-csv=…] [--cache-dir=임베딩 캐시 폴더] [--model=Xenova/multilingual-e5-large]
//   원문은 출력하지 않는다. 외부 라벨이 본인 데이터면 결과 숫자만 기록하고 파일은 저장소에 넣지 않는다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from '../../web/node_modules/fflate/esm/index.mjs'
import { pipeline } from '../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'
import { parseConversationsJson } from '../../web/src/parser/chatgpt.ts'
import { normalizeConversations } from '../../web/src/parser/normalize.ts'
import { SEED_TEXTS, SEED_TYPES, TASK_TYPES } from '../../web/src/classify/classifier.ts'
import { trainLinear } from './linear.mjs'

const flag = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const [zip, csv, xzip, xcsv] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const MODEL = flag('model') ?? 'Xenova/multilingual-e5-small'
const C = [...TASK_TYPES, 'other']
const K = 5

// ---------- 데이터: 라벨 + 같은 대화의 모든 발화(문맥용, 순서 idx) ----------
function load(zipPath, csvPath, okOnly) {
  const f = unzipSync(new Uint8Array(readFileSync(zipPath)))
  const convs = Object.entries(f).filter(([n]) => /conversations[^/]*\.json$/i.test(n)).flatMap(([, b]) => parseConversationsJson(JSON.parse(new TextDecoder().decode(b))).conversations)
  const utts = normalizeConversations(convs).filter((u) => !okOnly || u.status === 'ok')
  const label = new Map(readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.trim().split(',')).filter((r) => r[2]).map((r) => [r[1], r[2]]))
  const convSet = new Set(utts.filter((u) => label.has(u.messageId)).map((u) => u.conversationId))
  // 라벨이 있는 대화의 발화 전부(문맥 필요·라벨 없음도 문맥으로는 쓴다). type이 평가 대상이면 gold.
  return utts.filter((u) => convSet.has(u.conversationId)).map((u) => ({ conversationId: u.conversationId, messageId: u.messageId, idx: u.idx, text: u.text, gold: C.includes(label.get(u.messageId)) ? label.get(u.messageId) : null }))
}
const pub = load(zip, csv, false), rare = load(xzip, xcsv, false).filter((x) => x.gold)
const testZip = flag('test-zip'), test = testZip ? load(testZip, flag('test-csv'), true) : []

// ---------- 임베딩(캐시: messageId → 벡터) ----------
const cacheDir = flag('cache-dir')
const cachePath = cacheDir && join(cacheDir, `context-emb-${MODEL.split('/').pop()}.json`)
const cache = cachePath && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}
const pipe = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
async function embedAll(list, key) {
  const need = list.filter((x) => !cache[key(x)])
  for (let i = 0; i < need.length; i += 16) {
    const o = await pipe(need.slice(i, i + 16).map((x) => 'query: ' + x.text), { pooling: 'mean', normalize: true })
    const d = o.dims[1]; for (let k = 0; k < o.dims[0]; k++) cache[key(need[i + k])] = Array.from(o.data.slice(k * d, (k + 1) * d))
  }
  return list.map((x) => cache[key(x)])
}
const seedV = await embedAll(SEED_TEXTS.map((t, i) => ({ text: t, i })), (x) => 'seed:' + x.i)
const pubV = await embedAll(pub, (x) => x.messageId), rareV = await embedAll(rare, (x) => x.messageId), testV = await embedAll(test, (x) => 't:' + x.messageId)
if (cachePath) writeFileSync(cachePath, JSON.stringify(cache))

// ---------- A: TF-IDF(문자 1~3gram) + 소프트맥스, 확률을 낸다(run_abc.mjs와 같은 계산) ----------
let seed = 7
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
const ngrams = (text) => { const t = text.toLowerCase().replace(/\s+/g, ' '), out = []; for (const n of [1, 2, 3]) for (let i = 0; i + n <= t.length; i++) out.push(t.slice(i, i + n)); return out }
function trainA(texts, ys) {
  const df = new Map()
  for (const d of texts) for (const g of new Set(ngrams(d))) df.set(g, (df.get(g) ?? 0) + 1)
  const vocab = new Map([...df].filter(([, c]) => c >= 2).map(([g], i) => [g, i]))
  const idf = new Float32Array(vocab.size)
  for (const [g, i] of vocab) idf[i] = Math.log((1 + texts.length) / (1 + df.get(g))) + 1
  const vec = (text) => { const v = new Map(); for (const g of ngrams(text)) { const i = vocab.get(g); if (i != null) v.set(i, (v.get(i) ?? 0) + 1) } let n = 0; for (const [i, c] of v) { const w = (1 + Math.log(c)) * idf[i]; v.set(i, w); n += w * w } n = Math.sqrt(n) || 1; for (const [i, w] of v) v.set(i, w / n); return v }
  const W = C.map(() => new Float32Array(vocab.size)), b = new Float32Array(C.length), X = texts.map(vec), yi = ys.map((y) => C.indexOf(y)), order = X.map((_, i) => i)
  const probs = (x) => { const z = C.map((_, k) => { let s = b[k]; for (const [f, v] of x) s += W[k][f] * v; return s }); const mx = Math.max(...z), e = z.map((s) => Math.exp(s - mx)), Z = e.reduce((a, c) => a + c, 0); return e.map((s) => s / Z) }
  for (let ep = 0; ep < 40; ep++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    for (const i of order) { const p = probs(X[i]); for (let k = 0; k < C.length; k++) { const g = p[k] - (k === yi[i] ? 1 : 0); b[k] -= 0.5 * g; for (const [f, v] of X[i]) W[k][f] -= 0.5 * (g * v + 1e-4 * W[k][f]) } }
  }
  return (text) => probs(vec(text))
}
// D: 선형 분류기 확률(클래스 순서를 C에 맞춘다)
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
const probsD = (m, v) => { const z = C.map((c) => { const k = m.classes.indexOf(c); return k < 0 ? -Infinity : m.b[k] + dot(m.W[k], v) }); const mx = Math.max(...z), e = z.map((s) => Math.exp(s - mx)), Z = e.reduce((a, c) => a + c, 0); return e.map((s) => s / Z) }

// ---------- 섞기 ----------
const BETAS = [0, 0.25, 0.5] // A 비중
const MODES = ['none', 'prev', 'conv'] // 문맥: 없음 / 바로 앞 메시지 / 같은 대화 나머지 평균
const LAMBDAS = [0.25, 0.5, 1]
const CONFIGS = [{ beta: 0, mode: 'none', lam: 0 }]
for (const beta of BETAS) for (const mode of MODES) for (const lam of mode === 'none' ? [0] : LAMBDAS) if (beta || mode !== 'none') CONFIGS.push({ beta, mode, lam })
const cname = (c) => `A 비중 ${c.beta} · 문맥 ${c.mode === 'none' ? '없음' : c.mode === 'prev' ? '앞 메시지' : '대화 평균'}${c.mode === 'none' ? '' : ' ×' + c.lam}`
// list: 같은 대화 발화들(순서대로), base: 각 발화 확률 → 섞은 뒤 예측
function decide(list, base, c) {
  const byConv = new Map()
  list.forEach((x, i) => byConv.set(x.conversationId, [...(byConv.get(x.conversationId) ?? []), i]))
  for (const ids of byConv.values()) ids.sort((a, b) => list[a].idx - list[b].idx)
  const out = new Array(list.length)
  for (const ids of byConv.values()) ids.forEach((i, pos) => {
    let ctx = null
    if (c.mode === 'prev' && pos > 0) ctx = base[ids[pos - 1]]
    if (c.mode === 'conv' && ids.length > 1) { ctx = C.map(() => 0); for (const j of ids) if (j !== i) base[j].forEach((p, k) => (ctx[k] += p / (ids.length - 1))) }
    const p = ctx ? base[i].map((x, k) => x + c.lam * ctx[k]) : base[i]
    out[i] = C[p.indexOf(Math.max(...p))]
  })
  return out
}
const mix = (pd, pa, beta) => pd.map((p, i) => p.map((x, k) => (1 - beta) * x + beta * pa[i][k]))

function metrics(gold, pred) {
  const r = {}; let sp = 0, sf = 0
  for (const c of C) { const ng = gold.filter((g) => g === c).length, np = pred.filter((p) => p === c).length, tp = gold.filter((g, i) => g === c && pred[i] === c).length; const P = np ? tp / np : 0, R = ng ? tp / ng : 0, F = P + R ? (2 * P * R) / (P + R) : 0; r[c] = { P, R, F, ng }; }
  const pres = C.filter((c) => r[c].ng); for (const c of pres) { sp += r[c].P; sf += r[c].F }
  return { P: sp / pres.length, F: sf / pres.length, acc: gold.filter((g, i) => g === pred[i]).length / gold.length, wF: C.reduce((s, c) => s + r[c].F * r[c].ng, 0) / gold.length, r }
}
const line = (name, m) => `${name.padEnd(30)} | P ${m.P.toFixed(3)} | F1 ${m.F.toFixed(3)} | 가중F1 ${m.wF.toFixed(3)} | 정확도 ${m.acc.toFixed(3)} | 업무문서 ${m.r.work_doc.P.toFixed(2)}/${m.r.work_doc.R.toFixed(2)} | 기획 ${m.r.ideation.P.toFixed(2)}/${m.r.ideation.R.toFixed(2)}`

// ---------- 공개 표본 5겹 교차 검증(분할은 run_abc와 같다: 라벨 대상 대화를 같은 시드로 섞어 i % 5) ----------
const labeled = pub.filter((x) => x.gold)
const goldIds = new Set(labeled.map((x) => x.messageId))
const convIds = [...new Set(readFileSync(csv, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.trim().split(',')).filter((r) => goldIds.has(r[1])).map((r) => r[0]))] // CSV 순서(run_abc와 같은 분할)
for (let i = convIds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [convIds[i], convIds[j]] = [convIds[j], convIds[i]] }
const foldOf = new Map(convIds.map((c, i) => [c, i % K]))
const train = (idx) => {
  const lin = trainLinear([...seedV, ...idx.map((i) => pubV[i]), ...rareV], [...SEED_TYPES, ...idx.map((i) => pub[i].gold), ...rare.map((x) => x.gold)], { l2: 1e-2 })
  const a = trainA([...idx.map((i) => pub[i].text), ...rare.map((x) => x.text)], [...idx.map((i) => pub[i].gold), ...rare.map((x) => x.gold)])
  return { lin, a }
}
const pubIdx = pub.map((_, i) => i).filter((i) => foldOf.has(pub[i].conversationId))
const predCV = CONFIGS.map(() => new Array(pub.length)), nested = new Array(pub.length), picked = []
for (let f = 0; f < K; f++) {
  const tr = pubIdx.filter((i) => foldOf.get(pub[i].conversationId) !== f && pub[i].gold)
  const te = pubIdx.filter((i) => foldOf.get(pub[i].conversationId) === f)
  const { lin, a } = train(tr)
  const list = te.map((i) => pub[i]), pd = te.map((i) => probsD(lin, pubV[i])), pa = te.map((i) => a(pub[i].text))
  CONFIGS.forEach((c, ci) => decide(list, mix(pd, pa, c.beta), c).forEach((p, k) => (predCV[ci][te[k]] = p)))
  // 학습 겹 안에서 설정 고르기
  const inner = (f + 1) % K
  const fit = tr.filter((i) => foldOf.get(pub[i].conversationId) !== inner), valAll = pubIdx.filter((i) => foldOf.get(pub[i].conversationId) === inner)
  const mi = train(fit), vl = valAll.map((i) => pub[i]), vpd = valAll.map((i) => probsD(mi.lin, pubV[i])), vpa = valAll.map((i) => mi.a(pub[i].text))
  let best = null
  for (const c of CONFIGS) { const pr = decide(vl, mix(vpd, vpa, c.beta), c); const g = vl.map((x, k) => [x.gold, pr[k]]).filter(([x]) => x); const m = metrics(g.map((x) => x[0]), g.map((x) => x[1])); if (!best || m.F > best.F) best = { c, F: m.F } }
  picked.push(cname(best.c))
  decide(list, mix(pd, pa, best.c.beta), best.c).forEach((p, k) => (nested[te[k]] = p))
}
const ev = (pred) => { const ids = pubIdx.filter((i) => pub[i].gold); return metrics(ids.map((i) => pub[i].gold), ids.map((i) => pred[i])) }
console.log(`공개 표본 5겹 교차 검증 (평가 ${pubIdx.filter((i) => pub[i].gold).length}건, 보강 ${rare.length}건은 학습에만)`)
CONFIGS.forEach((c, ci) => console.log(line(cname(c), ev(predCV[ci]))))
console.log(line('학습 겹 안에서 고른 설정', ev(nested)) + '\n  겹별 선택: ' + picked.join(' / '))

// ---------- 외부 라벨 평가(학습: 공개 표본 전체 + 보강) ----------
if (test.length) {
  const { lin, a } = train(pub.map((_, i) => i).filter((i) => pub[i].gold))
  const pd = test.map((_, i) => probsD(lin, testV[i])), pa = test.map((x) => a(x.text))
  const g = test.map((x, i) => [x.gold, i]).filter(([x]) => x)
  console.log(`\n외부 라벨 평가 (평가 ${g.length}건, 문맥에 쓰인 같은 대화 메시지 ${test.length}건)`)
  for (const c of CONFIGS) { const pr = decide(test, mix(pd, pa, c.beta), c); console.log(line(cname(c), metrics(g.map((x) => x[0]), g.map((x) => pr[x[1]])))) }
}
