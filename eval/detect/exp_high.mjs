// 확실함 등급 실험: cache_embed.mjs 캐시로 제품과 같은 기준을 계산해 탐지하고, 라벨이 있으면 등급별 정밀도를 찍는다.
// 사용: node eval/detect/exp_high.mjs <캐시 접두어> [라벨 CSV...] [--dump=<파일>]
// --dump는 확실함 후보의 앞/뒤 원문을 파일로 쓴다(원문이 들어가므로 저장소 밖에만).
import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_OPTIONS, detect, nullDistribution, quantile, withinConversationNull } from '../../web/src/detect/detector.ts'

const args = process.argv.slice(2)
const dumpPath = args.find((a) => a.startsWith('--dump='))?.slice(7)
const [prefix, ...csvs] = args.filter((a) => !a.startsWith('--'))
const { dim, inputs } = JSON.parse(readFileSync(prefix + '.json', 'utf8'))
const buf = readFileSync(prefix + '.f32')
const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
const vec = (i) => data.subarray(i * dim, (i + 1) * dim)

// 제품(embed.worker.ts)과 같은 기준 계산
const cross = nullDistribution(inputs, vec)
const within = withinConversationNull(inputs, vec)
const nullThreshold = within.length >= 20 ? quantile(within, 0.9) : quantile(cross, 0.99)
const groupThreshold = {}
for (const g of new Set(inputs.map((u) => u.group))) {
  const ids = inputs.map((_, i) => i).filter((i) => inputs[i].group === g)
  const ws = withinConversationNull(ids.map((i) => inputs[i]), (k) => vec(ids[k]))
  if (ws.length >= 20) groupThreshold[g] = quantile(ws, 0.9)
}
const pairs = detect(inputs, vec, { ...DEFAULT_OPTIONS, nullThreshold, groupThreshold, markerFloor: quantile(cross, 0.9) })

const gold = new Map()
for (const f of csvs) for (const line of readFileSync(f, 'utf8').split('\n').slice(1)) {
  const [, messageId, , , label] = line.trim().split(',')
  if (messageId && label && label !== 'unsure') gold.set(messageId, label)
}
const by = { high: [0, 0, 0], medium: [0, 0, 0], low: [0, 0, 0] } // [맞음, 틀림, 라벨 없음]
for (const p of pairs) if (p.grade) { const g = gold.get(p.messageId); by[p.grade][g == null ? 2 : g === 'repeat' ? 0 : 1]++ }
const cnt = (g) => pairs.filter((p) => p.grade === g).length
console.log(`utterances=${inputs.length} 표시: 확실함 ${cnt('high')} · 가능성 있음 ${cnt('medium')} · 약함 ${cnt('low')}`)
for (const g of ['high', 'medium', 'low']) console.log(`  ${g}: 맞음 ${by[g][0]} · 틀림 ${by[g][1]} · 라벨 없음 ${by[g][2]}`)

if (dumpPath) {
  const byId = new Map(inputs.map((u) => [u.messageId, u]))
  const cut = (t) => t.replace(/\s+/g, ' ').slice(0, 600)
  const rows = pairs.filter((p) => p.grade === 'high').map((p, k) => `#${k + 1} [${gold.get(p.messageId) ?? '?'}] ${byId.get(p.messageId).group} sim=${p.similarity.toFixed(3)} gap=${p.gapMinutes?.toFixed(0)}분 id=${p.messageId}\n  앞: ${cut(byId.get(p.priorMessageId).text)}\n  뒤: ${cut(byId.get(p.messageId).text)}\n`)
  writeFileSync(dumpPath, rows.join('\n'))
  console.log('dump', rows.length, '→', dumpPath)
}
