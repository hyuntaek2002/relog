// 실데이터 쌍 라벨(pair-labels.csv)로 탐지기 정밀도·재현율을 잰다.
// 사용: node eval/detect/eval_pairs.mjs exports/conversations-000.zip eval/labels/pair-labels.csv
// 라벨 CSV: conversationId,messageId,priorMessageId,similarity,label(repeat|normal|resend|unsure). 원문 없음.
import { readFileSync } from 'node:fs'
import { unzipSync } from '../../web/node_modules/fflate/esm/index.mjs'
import { pipeline } from '../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'
import { parseConversationsJson } from '../../web/src/parser/chatgpt.ts'
import { normalizeConversations } from '../../web/src/parser/normalize.ts'
import { DEFAULT_OPTIONS, detect, nullDistribution, quantile, withinConversationNull } from '../../web/src/detect/detector.ts'
import { LABELED, SEED_TEXTS, SEED_TYPES, TaskClassifier, labeledFor } from '../../web/src/classify/classifier.ts'

const [zipPath, csvPath, model = 'Xenova/multilingual-e5-small'] = process.argv.slice(2)
const files = unzipSync(new Uint8Array(readFileSync(zipPath)))
const convs = Object.entries(files).filter(([n]) => /conversations[^/]*\.json$/i.test(n)).flatMap(([, b]) => parseConversationsJson(JSON.parse(new TextDecoder().decode(b))).conversations)
const ok = normalizeConversations(convs).filter((u) => u.status === 'ok')
const inputs = ok.map((u) => ({ conversationId: u.conversationId, messageId: u.messageId, idx: u.idx, createdAt: u.createdAt, text: u.text, tokenEstimate: u.tokenEstimate, hasAttachment: u.hasAttachment, prevAssistantIdx: u.prevAssistantIdx }))

const gold = new Map()
for (const line of readFileSync(csvPath, 'utf8').split('\n').slice(1)) {
  const [, messageId, , , label] = line.trim().split(',')
  if (messageId && label && label !== 'unsure') gold.set(messageId, label)
}
console.log(`utterances=${inputs.length} labeled=${gold.size} repeat=${[...gold.values()].filter((l) => l === 'repeat').length}`)

const pipe = await pipeline('feature-extraction', model, { dtype: 'q8' })
const out = await pipe(inputs.map((u) => (model.includes('e5') ? 'query: ' + u.text : u.text)), { pooling: 'mean', normalize: true })
const dim = out.dims[1]
const vec = (i) => out.data.subarray(i * dim, (i + 1) * dim)
// 제품과 같게: 대화 종류를 분류해 넣는다(상담·대화로 분류된 메시지는 탐지에서 빠진다)
const seedOut = await pipe(SEED_TEXTS.map((t) => (model.includes('e5') ? 'query: ' + t : t)), { pooling: 'mean', normalize: true })
const clf = new TaskClassifier(SEED_TYPES.map((_, i) => seedOut.data.slice(i * dim, (i + 1) * dim)), SEED_TYPES, undefined, labeledFor(model))
inputs.forEach((u, i) => { u.taskType = clf.linear(vec(i)).type })
console.log(`classifier: ${labeledFor(model) ? LABELED.version + ' 선형(D)' : '중심점(B, 라벨 자료 없음)'}`)
const cross = nullDistribution(inputs, vec)
const within = withinConversationNull(inputs, vec)
const floor = quantile(cross, 0.9)

function evaluate(name, nullThreshold, extra = {}) {
  const pairs = detect(inputs, vec, { ...DEFAULT_OPTIONS, nullThreshold, markerFloor: floor, ...extra })
  let tp = 0, fp = 0, fn = 0, tn = 0
  const miss = {}, alarm = {}, byGrade = {}
  for (const p of pairs) {
    const g = gold.get(p.messageId)
    if (!g) continue
    const pred = !!p.grade
    const pos = g === 'repeat'
    if (pred) { const b = (byGrade[p.grade] ??= { tp: 0, n: 0 }); b.n++; if (pos) b.tp++ }
    if (pred && pos) tp++
    else if (pred && !pos) { fp++; alarm[`${g}/${p.grade}`] = (alarm[`${g}/${p.grade}`] ?? 0) + 1 }
    else if (!pred && pos) { fn++; miss[p.exclusion] = (miss[p.exclusion] ?? 0) + 1 }
    else tn++
  }
  const P = tp / Math.max(1, tp + fp), R = tp / Math.max(1, tp + fn), F1 = (2 * P * R) / Math.max(1e-9, P + R)
  console.log(`\n== ${name} threshold=${nullThreshold.toFixed(3)}  P=${P.toFixed(2)} R=${R.toFixed(2)} F1=${F1.toFixed(2)}  tp=${tp} fp=${fp} fn=${fn} tn=${tn}`)
  console.log('  miss by exclusion:', JSON.stringify(miss), ' alarm by gold/grade:', JSON.stringify(alarm))
  console.log('  등급별 맞음/표시:', ['high', 'medium', 'low'].map((g) => `${g} ${byGrade[g]?.tp ?? 0}/${byGrade[g]?.n ?? 0}`).join(' · '))
}
console.log(`cross p99=${quantile(cross, 0.99).toFixed(3)} within p90=${quantile(within, 0.9).toFixed(3)} p95=${quantile(within, 0.95).toFixed(3)}`)
evaluate('within p90 + rescue (현재 기본값)', quantile(within, 0.9))
evaluate('within p95 + rescue', quantile(within, 0.95))
evaluate('cross p99 + rescue', quantile(cross, 0.99))
for (const abs of [0.9, 0.92, 0.94]) evaluate(`abs ${abs} + rescue`, abs)
