// 탐지 실험용 캐시: 내보내기 zip들을 제품과 같은 규칙으로 읽어 정규화·임베딩·과업 분류까지 해 두고 파일로 저장한다.
// 사용: node eval/detect/cache_embed.mjs <출력 접두어> <zip...>
// 출력: <접두어>.json(발화 메타와 원문 — 저장소 밖에 둘 것), <접두어>.f32(임베딩)
// 원문이 들어가므로 출력은 반드시 저장소 밖(임시 폴더)이나 exports/ 아래에 둔다.
import { readFileSync, writeFileSync } from 'node:fs'
import { unzipSync } from '../../web/node_modules/fflate/esm/index.mjs'
import { pipeline } from '../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'
import { parseConversationsJson } from '../../web/src/parser/chatgpt.ts'
import { dedupeForkedSessions, parseClaudeCodeSession } from '../../web/src/parser/claudeCode.ts'
import { normalizeConversations } from '../../web/src/parser/normalize.ts'
import { SEED_TEXTS, SEED_TYPES, TaskClassifier, labeledFor } from '../../web/src/classify/classifier.ts'

const [out, ...zips] = process.argv.slice(2)
const model = 'Xenova/multilingual-e5-small'
const isConvFile = (n) => /(^|\/)conversations[^/]*\.json$/i.test(n)
let convs = []
for (const z of zips) {
  const files = unzipSync(new Uint8Array(readFileSync(z)), { filter: (f) => isConvFile(f.name) || /\.jsonl$/i.test(f.name) })
  for (const [name, b] of Object.entries(files)) {
    const text = new TextDecoder().decode(b)
    if (isConvFile(name)) convs.push(...parseConversationsJson(JSON.parse(text)).conversations)
    else { const c = parseClaudeCodeSession(text, name); if (c) convs.push(c) }
  }
}
convs = dedupeForkedSessions(convs)
const clientOf = new Map(convs.map((c) => [c.id, c.client === 'code' ? 'code' : 'app']))
const ok = normalizeConversations(convs).filter((u) => u.status === 'ok')
const inputs = ok.map((u) => ({ conversationId: u.conversationId, messageId: u.messageId, idx: u.idx, createdAt: u.createdAt, text: u.text, tokenEstimate: u.tokenEstimate, hasAttachment: u.hasAttachment, prevAssistantIdx: u.prevAssistantIdx, group: clientOf.get(u.conversationId) ?? 'app' }))
console.log(`conversations=${convs.length} utterances=${inputs.length}`)

const pipe = await pipeline('feature-extraction', model, { dtype: 'q8' })
let dim = 0, data = null
for (let s = 0; s < inputs.length; s += 32) {
  const o = await pipe(inputs.slice(s, s + 32).map((u) => 'query: ' + u.text), { pooling: 'mean', normalize: true })
  dim = o.dims[1]
  data ??= new Float32Array(inputs.length * dim)
  data.set(o.data, s * dim)
  if (s % 640 === 0) console.log(`embedded ${s}/${inputs.length}`)
}
const seedOut = await pipe(SEED_TEXTS.map((t) => 'query: ' + t), { pooling: 'mean', normalize: true })
const clf = new TaskClassifier(SEED_TYPES.map((_, i) => seedOut.data.slice(i * dim, (i + 1) * dim)), SEED_TYPES, undefined, labeledFor(model))
inputs.forEach((u, i) => { u.taskType = clf.linear(data.subarray(i * dim, (i + 1) * dim)).type })
writeFileSync(out + '.json', JSON.stringify({ dim, inputs }))
writeFileSync(out + '.f32', Buffer.from(data.buffer))
console.log('saved', out)
