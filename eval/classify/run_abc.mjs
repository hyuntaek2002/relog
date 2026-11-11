// 과업 분류 A/B/C 비교. 라벨은 대화 단위로 학습/조정/평가(기본 240/80/80 비율)로 나눈다.
//   A: 문자 n-gram TF-IDF + 소프트맥스 선형 분류기(베이스라인)
//   B: 임베딩 + 유형별 중심점      C: 임베딩 + k-NN
//   D: 임베딩 + 소프트맥스 선형(계획서의 A·B·C에 더한 넷째 방식, linear.mjs). 예시 + 학습 분할로 학습하고 기타도 한 유형으로 배운다.
//   "B+기타"는 학습 분할의 기타 라벨로 기타의 중심점도 만든 것(기존 B·C는 기타를 임계값으로만 낸다).
// B·C는 (예시 발화만) / (예시 + 학습 분할) 두 가지로 평가한다. k·기타 임계값은 조정 분할에서 고른다.
// 사용:
//   node eval/classify/run_abc.mjs exports/conversations-000.zip eval/labels/labels.csv [model]
//   node eval/classify/run_abc.mjs --smoke [model]      # seed.json 예시로 모의 라벨 생성(동작 확인용)
//   … --extra-zip=<zip> --extra-csv=<라벨 CSV> 를 --cv와 같이 주면, 그 라벨(표본이 적은 유형 보강분, pick_rare.mjs)을 각 겹의 학습에만 더한 결과를 덧붙인다. 평가는 원래 표본으로만 한다
//   … --cv 를 붙이면 240/80/80 분할 결과 뒤에 대화 단위 5겹 교차 검증 결과를 덧붙인다(설정은 고정: k-NN k=3, other 임계값 없음)
// 라벨 CSV: conversationId,messageId,type  (type: coding|writing|learning|work_doc|search|ideation|translation|chat|other|context_required)
import { readFileSync } from 'node:fs'
import { unzipSync } from '../../web/node_modules/fflate/esm/index.mjs'
import { pipeline } from '../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'
import { parseConversationsJson } from '../../web/src/parser/chatgpt.ts'
import { normalizeConversations } from '../../web/src/parser/normalize.ts'
import { SEED_TEXTS, SEED_TYPES, TASK_TYPES, TaskClassifier } from '../../web/src/classify/classifier.ts'
import { trainLinear, predictLinear } from './linear.mjs'

const CV = process.argv.includes('--cv') // 대화 단위 5겹 교차 검증(평가 분할에 빠지는 유형이 없도록 전체를 한 번씩 평가)
const flag = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const smoke = process.argv.includes('--smoke')
const model = (smoke ? args[0] : args[2]) ?? 'Xenova/multilingual-e5-small'
const SPLIT = [240, 80, 80] // 비율로만 쓴다

// ---------- 데이터 ----------
let items = [] // { conversationId, messageId, text, type }
if (smoke) {
  // 예시 발화를 유형당 3개 대화에 나눠 담는다. 실제 라벨셋 전에 파이프라인만 확인.
  SEED_TEXTS.forEach((text, i) => items.push({ conversationId: `${SEED_TYPES[i]}-${i % 3}`, messageId: `s${i}`, text, type: SEED_TYPES[i] }))
} else {
  items = loadItems(args[0], args[1])
}
function loadItems(zipPath, csvPath) {
  const out = []
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)))
  const convs = Object.entries(files).filter(([n]) => /conversations[^/]*\.json$/i.test(n)).flatMap(([, b]) => parseConversationsJson(JSON.parse(new TextDecoder().decode(b))).conversations)
  const textById = new Map(normalizeConversations(convs).map((u) => [u.messageId, u.text]))
  for (const line of readFileSync(csvPath, 'utf8').split('\n').slice(1)) {
    const [conversationId, messageId, type] = line.trim().split(',')
    if (!messageId || !type || type === 'context_required') continue // 문맥 필요는 분류 평가 대상 아님
    const text = textById.get(messageId)
    if (text) out.push({ conversationId, messageId, text, type })
  }
  return out
}
const CLASSES = [...TASK_TYPES, 'other']
console.log(`items=${items.length} classes=${CLASSES.length} model=${model}${smoke ? ' (smoke)' : ''}`)

// ---------- 대화 단위 분할(결정적) ----------
let seed = 7
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
const convIds = [...new Set(items.map((x) => x.conversationId))]
for (let i = convIds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [convIds[i], convIds[j]] = [convIds[j], convIds[i]] }
const total = SPLIT.reduce((a, b) => a + b, 0)
const nTrain = Math.round((convIds.length * SPLIT[0]) / total), nDev = Math.round((convIds.length * SPLIT[1]) / total)
const splitOf = new Map(convIds.map((c, i) => [c, i < nTrain ? 'train' : i < nTrain + nDev ? 'dev' : 'test']))
const part = (name) => items.filter((x) => splitOf.get(x.conversationId) === name)
const train = part('train'), dev = part('dev'), test = part('test')
console.log(`split by conversation: train=${train.length} dev=${dev.length} test=${test.length} (convs ${nTrain}/${nDev}/${convIds.length - nTrain - nDev})`)

// ---------- 지표 ----------
function metrics(gold, pred, label) {
  const cm = Object.fromEntries(CLASSES.map((c) => [c, Object.fromEntries(CLASSES.map((d) => [d, 0]))]))
  gold.forEach((g, i) => { cm[g][pred[i]]++ })
  let f1s = []
  const rows = []
  for (const c of CLASSES) {
    const tp = cm[c][c], fp = CLASSES.reduce((s, d) => s + (d !== c ? cm[d][c] : 0), 0), fn = CLASSES.reduce((s, d) => s + (d !== c ? cm[c][d] : 0), 0)
    const support = tp + fn
    if (!support) continue
    const P = tp / Math.max(1, tp + fp), R = tp / Math.max(1, support), F = (2 * P * R) / Math.max(1e-9, P + R)
    f1s.push(F)
    rows.push(`${c.padEnd(12)} P=${P.toFixed(2)} R=${R.toFixed(2)} F1=${F.toFixed(2)} n=${support}`)
  }
  const macro = f1s.reduce((a, b) => a + b, 0) / Math.max(1, f1s.length)
  const acc = gold.filter((g, i) => g === pred[i]).length / Math.max(1, gold.length)
  return { macro, acc, rows, cm }
}
function report(name, gold, pred) {
  const m = metrics(gold, pred)
  console.log(`\n== ${name}: macroF1=${m.macro.toFixed(3)} acc=${m.acc.toFixed(3)} (n=${gold.length})`)
  for (const r of m.rows) console.log('  ' + r)
  const used = CLASSES.filter((c) => gold.includes(c) || pred.includes(c))
  console.log('  confusion (rows=gold, cols=pred): ' + used.join(' '))
  for (const g of used) console.log('  ' + g.padEnd(12) + used.map((p) => String(m.cm[g][p]).padStart(4)).join(''))
  return m.macro
}

// ---------- A: 문자 n-gram TF-IDF + 소프트맥스 회귀 ----------
function ngrams(text, ns = [1, 2, 3]) {
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  const out = []
  for (const n of ns) for (let i = 0; i + n <= t.length; i++) out.push(t.slice(i, i + n))
  return out
}
function tfidfModel(docs) {
  const df = new Map()
  for (const d of docs) for (const g of new Set(ngrams(d))) df.set(g, (df.get(g) ?? 0) + 1)
  const vocab = new Map([...df].filter(([, c]) => c >= 2).map(([g], i) => [g, i]))
  const idf = new Float32Array(vocab.size)
  for (const [g, i] of vocab) idf[i] = Math.log((1 + docs.length) / (1 + df.get(g))) + 1
  const vec = (text) => {
    const v = new Map()
    for (const g of ngrams(text)) { const i = vocab.get(g); if (i != null) v.set(i, (v.get(i) ?? 0) + 1) }
    let norm = 0
    for (const [i, c] of v) { const w = (1 + Math.log(c)) * idf[i]; v.set(i, w); norm += w * w }
    norm = Math.sqrt(norm) || 1
    for (const [i, w] of v) v.set(i, w / norm)
    return v // sparse
  }
  return { vec, size: vocab.size }
}
function trainSoftmax(X, y, dim, { epochs = 40, lr = 0.5, l2 = 1e-4 } = {}) {
  const K = CLASSES.length
  const W = Array.from({ length: K }, () => new Float32Array(dim)), b = new Float32Array(K)
  const yi = y.map((c) => CLASSES.indexOf(c))
  const order = X.map((_, i) => i)
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    for (const i of order) {
      const x = X[i]
      const z = new Float64Array(K)
      for (let k = 0; k < K; k++) { let s = b[k]; for (const [f, v] of x) s += W[k][f] * v; z[k] = s }
      const mx = Math.max(...z); let Z = 0; for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - mx); Z += z[k] }
      for (let k = 0; k < K; k++) {
        const g = z[k] / Z - (k === yi[i] ? 1 : 0)
        b[k] -= lr * g
        for (const [f, v] of x) W[k][f] -= lr * (g * v + l2 * W[k][f])
      }
    }
  }
  return (x) => { let best = 0, bs = -Infinity; for (let k = 0; k < K; k++) { let s = b[k]; for (const [f, v] of x) s += W[k][f] * v; if (s > bs) { bs = s; best = k } } return CLASSES[best] }
}
const tfidf = tfidfModel(train.map((x) => x.text))
const predictA = trainSoftmax(train.map((x) => tfidf.vec(x.text)), train.map((x) => x.type), tfidf.size)
const results = []
results.push(['A TF-IDF+softmax', report('A: TF-IDF(char 1-3gram, 학습 ' + train.length + ') + softmax [test]', test.map((x) => x.type), test.map((x) => predictA(tfidf.vec(x.text))))])

// ---------- 임베딩 ----------
const pipe = await pipeline('feature-extraction', model, { dtype: 'q8' })
const prep = (t) => (model.includes('e5') ? 'query: ' + t : t)
async function embed(texts) {
  const out = await pipe(texts.map(prep), { pooling: 'mean', normalize: true })
  const dim = out.dims[1]
  return texts.map((_, i) => out.data.slice(i * dim, (i + 1) * dim))
}
const seedVecs = await embed(SEED_TEXTS)
const trainVecs = await embed(train.map((x) => x.text))
const devVecs = await embed(dev.map((x) => x.text))
const testVecs = await embed(test.map((x) => x.text))
// 'other' 라벨은 예시가 없어 중심점을 만들 수 없다 → B·C는 임계값으로만 other를 낸다
const trainIdx = train.map((x, i) => i).filter((i) => train[i].type !== 'other')

for (const [variant, vecs, types] of [
  ['예시만', seedVecs, SEED_TYPES],
  ['예시+학습', [...seedVecs, ...trainIdx.map((i) => trainVecs[i])], [...SEED_TYPES, ...trainIdx.map((i) => train[i].type)]],
]) {
  // 조정 분할에서 k·other 임계값 선택
  // 방식별로 따로 고른다(k는 k-NN에만, other 임계값은 둘 다)
  const best = {}
  for (const method of ['centroid', 'knn']) {
    best[method] = { k: 5, th: 0, macro: -1 }
    for (const k of method === 'knn' ? [3, 5, 7, 9] : [1]) for (const th of [0, 0.8, 0.84, 0.88]) {
      const clf = new TaskClassifier(vecs, types, { k, otherBelow: th })
      const pred = devVecs.map((v) => clf.predict(v, method).type)
      const m = dev.length ? metrics(dev.map((x) => x.type), pred).macro : 0
      if (m > best[method].macro) best[method] = { k, th, macro: m }
    }
  }
  for (const method of ['centroid', 'knn']) {
    const { k, th } = best[method]
    const clf = new TaskClassifier(vecs, types, { k, otherBelow: th })
    const name = `${method === 'centroid' ? 'B 중심점' : `C k-NN(k=${k})`} / ${variant}${th ? ` / other<${th}` : ''}`
    results.push([name, report(name + ' [test]', test.map((x) => x.type), testVecs.map((v) => clf.predict(v, method).type))])
  }
  console.log(`  (dev에서 고른 설정: centroid other<${best.centroid.th} macroF1=${best.centroid.macro.toFixed(3)} / knn k=${best.knn.k} other<${best.knn.th} macroF1=${best.knn.macro.toFixed(3)})`)
}

// ---------- D: 임베딩 + 선형. 규제 세기(l2)는 조정 분할에서 고른다 ----------
const L2S = [1e-2, 1e-3, 1e-4]
{
  const X = [...seedVecs, ...trainVecs], y = [...SEED_TYPES, ...train.map((x) => x.type)]
  let best = { l2: L2S[0], macro: -1, m: null }
  for (const l2 of L2S) {
    const m = trainLinear(X, y, { l2 })
    const macro = dev.length ? metrics(dev.map((x) => x.type), devVecs.map((v) => predictLinear(m, v))).macro : 0
    if (macro > best.macro) best = { l2, macro, m }
  }
  const name = `D 임베딩+선형 / 예시+학습 (l2=${best.l2})`
  results.push([name, report(name + ' [test]', test.map((x) => x.type), testVecs.map((v) => predictLinear(best.m, v)))])
}

console.log('\n=== summary (test macro F1) ===')
for (const [n, m] of results.sort((a, b) => b[1] - a[1])) console.log(`${m.toFixed(3)}  ${n}`)

// ---------- 교차 검증(--cv): 한 번의 분할은 평가 80건에 일부 유형이 아예 안 들어갈 수 있다. 전체를 5겹으로 돌려 모든 항목을 한 번씩 평가한다 ----------
if (CV) {
  const K = 5
  const foldOf = new Map(convIds.map((c, i) => [c, i % K])) // convIds는 위에서 결정적으로 섞여 있다
  const allVecs = []
  for (let i = 0; i < items.length; i += 64) allVecs.push(...(await embed(items.slice(i, i + 64).map((x) => x.text))))
  const pred = { A: [], Bseed: [], Cseed: [], Btrain: [], Ctrain: [], Bother: [], D: [], BotherX: [], DX: [] }
  // 보강분: 학습에만 더한다(평가 겹에는 넣지 않는다)
  const extra = flag('extra-zip') && flag('extra-csv') ? loadItems(flag('extra-zip'), flag('extra-csv')) : []
  const extraVecs = extra.length ? await embed(extra.map((x) => x.text)) : []
  const extraTypes = extra.map((x) => x.type)
  const pickedL2 = []
  const seedClf = new TaskClassifier(seedVecs, SEED_TYPES) // 제품과 같은 기본 설정(예시 발화만)
  for (let f = 0; f < K; f++) {
    const tr = items.map((_, i) => i).filter((i) => foldOf.get(items[i].conversationId) !== f)
    const te = items.map((_, i) => i).filter((i) => foldOf.get(items[i].conversationId) === f)
    const tf = tfidfModel(tr.map((i) => items[i].text))
    const predictFold = trainSoftmax(tr.map((i) => tf.vec(items[i].text)), tr.map((i) => items[i].type), tf.size)
    const trNo = tr.filter((i) => items[i].type !== 'other')
    const trainClf = new TaskClassifier([...seedVecs, ...trNo.map((i) => allVecs[i])], [...SEED_TYPES, ...trNo.map((i) => items[i].type)], { k: 3, otherBelow: 0 })
    // B+기타: 기타 라벨도 한 유형으로 중심점을 만든다
    const otherClf = new TaskClassifier([...seedVecs, ...tr.map((i) => allVecs[i])], [...SEED_TYPES, ...tr.map((i) => items[i].type)], { k: 3, otherBelow: 0 })
    // D: l2는 학습 4겹 중 한 겹을 떼어 고른 뒤(평가 겹은 보지 않는다) 4겹 전체로 다시 학습
    const inner = (f + 1) % K
    const fit = tr.filter((i) => foldOf.get(items[i].conversationId) !== inner), val = tr.filter((i) => foldOf.get(items[i].conversationId) === inner)
    let l2 = L2S[0], bestM = -1
    for (const c of L2S) {
      const m = trainLinear([...seedVecs, ...fit.map((i) => allVecs[i])], [...SEED_TYPES, ...fit.map((i) => items[i].type)], { l2: c })
      const macro = metrics(val.map((i) => items[i].type), val.map((i) => predictLinear(m, allVecs[i]))).macro
      if (macro > bestM) { bestM = macro; l2 = c }
    }
    pickedL2.push(l2)
    const lin = trainLinear([...seedVecs, ...tr.map((i) => allVecs[i])], [...SEED_TYPES, ...tr.map((i) => items[i].type)], { l2 })
    const linX = extra.length ? trainLinear([...seedVecs, ...tr.map((i) => allVecs[i]), ...extraVecs], [...SEED_TYPES, ...tr.map((i) => items[i].type), ...extraTypes], { l2 }) : null
    const otherX = extra.length ? new TaskClassifier([...seedVecs, ...tr.map((i) => allVecs[i]), ...extraVecs], [...SEED_TYPES, ...tr.map((i) => items[i].type), ...extraTypes], { k: 3, otherBelow: 0 }) : null
    for (const i of te) {
      if (linX) { pred.DX[i] = predictLinear(linX, allVecs[i]); pred.BotherX[i] = otherX.predict(allVecs[i], 'centroid').type }
      pred.Bother[i] = otherClf.predict(allVecs[i], 'centroid').type
      pred.D[i] = predictLinear(lin, allVecs[i])
      pred.A[i] = predictFold(tf.vec(items[i].text))
      pred.Bseed[i] = seedClf.predict(allVecs[i], 'centroid').type
      pred.Cseed[i] = seedClf.predict(allVecs[i], 'knn').type
      pred.Btrain[i] = trainClf.predict(allVecs[i], 'centroid').type
      pred.Ctrain[i] = trainClf.predict(allVecs[i], 'knn').type
    }
  }
  const gold = items.map((x) => x.type)
  console.log(`\n##### ${K}겹 교차 검증 (대화 단위, 전체 ${items.length}건) #####`)
  const cv = [
    [`D 임베딩+선형 / 예시+학습 4겹 (겹별 l2 ${pickedL2.join(', ')})`, report('CV D: 임베딩 + 선형 / 예시+학습', gold, pred.D)],
    ['B 중심점+기타 / 예시+학습 4겹', report('CV B+기타: 중심점(기타 포함) / 예시+학습', gold, pred.Bother)],
    ['A TF-IDF+softmax (학습 4겹)', report('CV A: TF-IDF + softmax', gold, pred.A)],
    ['C k-NN / 예시+학습 4겹 (k=3)', report('CV C: k-NN / 예시+학습', gold, pred.Ctrain)],
    ['B 중심점 / 예시+학습 4겹', report('CV B: 중심점 / 예시+학습', gold, pred.Btrain)],
    ['C k-NN / 예시만 (제품 기본 설정)', report('CV C: k-NN / 예시만 (제품 기본 설정)', gold, pred.Cseed)],
    ['B 중심점 / 예시만', report('CV B: 중심점 / 예시만', gold, pred.Bseed)],
  ]
  if (extra.length) {
    cv.push([`D 임베딩+선형 / 예시+학습 4겹+보강 ${extra.length}건`, report('CV D + 보강(학습에만)', gold, pred.DX)])
    cv.push([`B 중심점+기타 / 예시+학습 4겹+보강 ${extra.length}건`, report('CV B+기타 + 보강(학습에만)', gold, pred.BotherX)])
  }
  console.log('\n=== summary (5겹 교차 검증 macro F1) ===')
  for (const [n, m] of cv.sort((a, b) => b[1] - a[1])) console.log(`${m.toFixed(3)}  ${n}`)
}
