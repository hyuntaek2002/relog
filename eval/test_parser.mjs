// 파서 자가 점검. 사용: node eval/test_parser.mjs
import assert from 'node:assert/strict'
import { parseConversationsJson } from '../web/src/parser/chatgpt.ts'
import { basicStats } from '../web/src/parser/stats.ts'
import { convs } from './fixtures/make_fixture.mjs'

const r = parseConversationsJson(convs)
assert.equal(r.errors.length, 1, 'broken 대화 1건은 오류로 기록')
assert.equal(r.errors[0].conversationId, 'c-broken')
assert.equal(r.conversations.length, 3)

const long = r.conversations[0]
assert.equal(long.turns.filter((t) => t.role === 'user').length, 12)
assert.equal(long.turns.length, 24, '숨김 system 제외, 분기 제외')
assert.ok(!long.turns.some((t) => t.text.includes('DEAD BRANCH')), '비활성 분기 제외')
assert.ok(long.turns[5].text.startsWith('```python'), 'code content_type 변환')
assert.equal(long.turns[0].createdAt, (1760000000 + 60) * 1000)

const s = basicStats(r.conversations)
assert.deepEqual({ ...s, userTokenEstimate: 0 }, { conversations: 3, userTurns: 15, assistantTurns: 15, longConversations: 1, judgeableUserTurns: 14, userTokenEstimate: 0, firstAt: (1760000000 + 60) * 1000, lastAt: (1760000000 + 90 * 12) * 1000 })
console.log('parser ok', s)

// Claude 형식: 같은 배열에 섞여 있어도 항목별로 판별
const claude = parseConversationsJson([
  { uuid: 'cl-1', name: 'claude conv', created_at: '2026-10-01T00:00:00Z', chat_messages: [
    { uuid: 'a', sender: 'human', text: '안녕', content: [{ type: 'text', text: '안녕' }], created_at: '2026-10-01T00:00:01Z' },
    { uuid: 'b', sender: 'assistant', text: '', content: [{ type: 'tool_use' }, { type: 'text', text: '네' }], created_at: '2026-10-01T00:00:02Z' },
    { uuid: 'c', sender: 'human', text: '', content: [], created_at: '2026-10-01T00:00:03Z' },
  ] },
  { uuid: 'cl-2', name: 'no messages' },
])
assert.equal(claude.conversations.length, 1)
assert.equal(claude.errors[0].conversationId, 'cl-2')
const cc = claude.conversations[0]
assert.equal(cc.platform, 'claude')
assert.deepEqual(cc.turns.map((t) => [t.role, t.text]), [['user', '안녕'], ['assistant', '네']], '빈 발화 제외, text 파트만')
assert.equal(cc.turns[0].createdAt, Date.parse('2026-10-01T00:00:01Z'))
console.log('claude ok')

// Claude 분기: 같은 parent를 가진 형제 중 마지막 메시지에서 거슬러 올라간 쪽만 활성
const ROOT = '00000000-0000-4000-8000-000000000000'
const br = parseConversationsJson([{ uuid: 'cl-br', name: 'branch', chat_messages: [
  { uuid: 'h1', parent_message_uuid: ROOT, sender: 'human', text: '첫 질문' },
  { uuid: 'a1', parent_message_uuid: 'h1', sender: 'assistant', text: 'DEAD' },
  { uuid: 'a2', parent_message_uuid: 'h1', sender: 'assistant', text: '재생성 답' },
  { uuid: 'h2', parent_message_uuid: 'a2', sender: 'human', text: '둘째 질문' },
] }])
assert.deepEqual(br.conversations[0].turns.map((t) => t.text), ['첫 질문', '재생성 답', '둘째 질문'])
console.log('claude branch ok')

// 정규화
const { normalizeText, classifyStatus, normalizeConversations, normalizeStats } = await import('../web/src/parser/normalize.ts')
const nt = normalizeText('이거 고쳐줘\n```python\nprint(1)\n```\n그리고 ```\nx\n```')
assert.equal(nt.text, '이거 고쳐줘\n[CODE_BLOCK python]\n그리고 [CODE_BLOCK unknown]')
assert.deepEqual(nt.codeLangs, ['python', 'unknown'])
assert.equal(normalizeText('a'.repeat(2000)).truncated, true)
assert.equal(classifyStatus('응', false), 'skipped')
assert.equal(classifyStatus('계속해줘!!', false), 'skipped')
assert.equal(classifyStatus('', false), 'skipped')
assert.equal(classifyStatus('이거 다시 해줘', false), 'context_required')
assert.equal(classifyStatus('번역해줘: hello', false), 'ok', '짧아도 지시어 없으면 ok')
assert.equal(classifyStatus('이거 다시 해줘 [CODE_BLOCK py]', true), 'ok', '코드 있으면 문맥 있음')
const us = normalizeConversations(r.conversations)
const ns = normalizeStats(us)
assert.equal(ns.total, 15)
assert.equal(ns.skipped, 1, '고마워 제외')
console.log('normalize ok', ns)
