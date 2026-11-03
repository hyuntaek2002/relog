// 합성 ChatGPT 내보내기 zip 생성. 실제 파일이 오기 전 파서 검증용.
// 사용: node eval/fixtures/make_fixture.mjs  → eval/fixtures/synthetic-export.zip
import { zipSync, strToU8 } from '../../web/node_modules/fflate/esm/index.mjs'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let n = 0
const uid = () => `m${++n}`
const base = 1760000000

function conv(title, userTexts, { branch = false, hidden = false, broken = false } = {}) {
  const mapping = {}
  const rootId = uid()
  mapping[rootId] = { id: rootId, message: null, parent: null, children: [] }
  let parent = rootId
  let t = base
  const add = (msg) => {
    const id = uid()
    mapping[id] = { id, message: { id, ...msg }, parent, children: [] }
    mapping[parent].children.push(id)
    parent = id
    return id
  }
  if (hidden) add({ author: { role: 'system' }, create_time: t, content: { content_type: 'text', parts: [''] }, metadata: { is_visually_hidden_from_conversation: true }, recipient: 'all' })
  userTexts.forEach((u, i) => {
    add({ author: { role: 'user' }, create_time: (t += 60), content: { content_type: 'text', parts: [u] }, metadata: {}, recipient: 'all' })
    if (branch && i === 1) {
      // 재생성된 응답: 형제 노드가 하나 더 있지만 활성 경로엔 하나만 들어가야 함
      const p = parent
      const dead = uid()
      mapping[dead] = { id: dead, message: { id: dead, author: { role: 'assistant' }, create_time: t, content: { content_type: 'text', parts: ['DEAD BRANCH'] }, metadata: {}, recipient: 'all' }, parent: p, children: [] }
      mapping[p].children.push(dead)
    }
    add({ author: { role: 'assistant' }, create_time: (t += 30), content: i % 3 === 2 ? { content_type: 'code', language: 'python', text: 'print(1)' } : { content_type: 'text', parts: [`답변 ${i + 1}`] }, metadata: {}, recipient: 'all' })
  })
  const c = { title, create_time: base, update_time: t, mapping, current_node: parent, conversation_id: `c-${title}`, id: `c-${title}` }
  if (broken) delete c.current_node
  return c
}

const long = Array.from({ length: 12 }, (_, i) => (i === 7 ? '아까 말했듯이 한국어로 답해줘' : `요청 ${i + 1}: 로그인 기능을 구현해줘`))
export const convs = [
  conv('long-with-branch', long, { branch: true, hidden: true }),
  conv('short', ['번역해줘: hello', '고마워']),
  conv('single', ['오늘 날씨 어때?']),
  conv('broken', ['x'], { broken: true }),
]

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = dirname(fileURLToPath(import.meta.url))
  const zip = zipSync({ 'conversations.json': strToU8(JSON.stringify(convs)), 'user.json': strToU8('{}') })
  writeFileSync(join(dir, 'synthetic-export.zip'), zip)
  console.log('wrote synthetic-export.zip', zip.length, 'bytes')
}
