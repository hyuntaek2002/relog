// 평가 표본 늘리기: 풀(wildchat-ko-pool.zip, 400 표본과 겹치지 않는 무작위 대화)에서 대화 단위로 무작위로 골라 발화 약 N개 표본을 만든다.
// 보강분(wildchat-ko-rare.zip)의 대화는 분류기 점수·낱말로 고른 것이라 무작위가 아니므로 뺀다.
// 사용: node eval/classify/sample_pool.mjs [목표 발화 수=400] [seed=20261117]
//   → exports/public/wildchat-ko-more.zip(원문, 저장소 제외), exports/public/wildchat-ko-more-texts.json(제안 라벨 작업용 id·원문, 저장소 제외)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync, strToU8 } from '../../web/node_modules/fflate/esm/index.mjs'
import { parseConversationsJson } from '../../web/src/parser/chatgpt.ts'
import { normalizeConversations } from '../../web/src/parser/normalize.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pub = join(here, '../../exports/public')
const [target = 400, seedArg = 20261117] = process.argv.slice(2).map(Number)
const read = (f) => JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(readFileSync(join(pub, f))))['conversations.json']))
const pool = read('wildchat-ko-pool.zip')
const rareIds = new Set(read('wildchat-ko-rare.zip').map((c) => c.id))
const utts = normalizeConversations(parseConversationsJson(pool).conversations).filter((u) => u.status === 'ok')
const byConv = new Map()
for (const u of utts) if (!rareIds.has(u.conversationId)) byConv.set(u.conversationId, [...(byConv.get(u.conversationId) ?? []), u])

let s = seedArg >>> 0
const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
const ids = [...byConv.keys()].sort()
for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]] }
const keep = new Set(), picked = []
for (const id of ids) { if (picked.length >= target) break; keep.add(id); picked.push(...byConv.get(id)) }

writeFileSync(join(pub, 'wildchat-ko-more.zip'), zipSync({ 'conversations.json': strToU8(JSON.stringify(pool.filter((c) => keep.has(c.id)))) }))
writeFileSync(join(pub, 'wildchat-ko-more-texts.json'), JSON.stringify(picked.map((u) => ({ conversationId: u.conversationId, messageId: u.messageId, text: u.text }))))
console.log({ poolConversations: byConv.size + rareIds.size, excludedRare: rareIds.size, conversations: keep.size, utterances: picked.length })
