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

// 분류기 B·C: 2차원 단위 벡터로 동작 확인
const { TaskClassifier, SEED_TEXTS, SEED_TYPES, TASK_TYPES } = await import('../web/src/classify/classifier.ts')
assert.equal(TASK_TYPES.length, 8)
assert.equal(SEED_TEXTS.length, SEED_TYPES.length)
assert.ok(TASK_TYPES.every((t) => SEED_TYPES.filter((s) => s === t).length >= 15), '유형별 15개 이상')
const unit = (deg) => new Float32Array([Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)])
const vecs = [unit(0), unit(5), unit(-5), unit(90), unit(85), unit(95)]
const types = ['coding', 'coding', 'coding', 'chat', 'chat', 'chat']
const clf = new TaskClassifier(vecs, types, { k: 3, otherBelow: 0.5 })
assert.equal(clf.centroid(unit(10)).type, 'coding')
assert.equal(clf.knn(unit(80)).type, 'chat')
assert.equal(clf.knn(unit(180)).type, 'other', '유사도 낮으면 기타')
console.log('classifier ok')

// 반복 탐지 0.2: 귀무분포 경계·발화 유형·재전송/범용 제외·등급 규칙
const { detect, summarize, nullDistribution, quantile, kindOf, editRatio, REPEAT_RE, COMPLAINT_RE } = await import('../web/src/detect/detector.ts')
assert.equal(kindOf('로그인 기능 구현해줘'), 'instruction')
assert.equal(kindOf('휴학을 하는게 맞지?'), 'question')
assert.equal(kindOf('오늘 하루 진짜 힘들었어'), 'other')
assert.ok(editRatio('abcdef', 'abcdxf') < 0.2 && editRatio('abc', 'xyz') === 1)
assert.ok(REPEAT_RE.test('왜 빠졌어') && REPEAT_RE.test('한국어로 하랬잖아'.replace('하랬잖아','했잖아')) && !REPEAT_RE.test('로그인 구현해줘'))
assert.ok(COMPLAINT_RE.test('궁금해서 물어보는거라니까') && COMPLAINT_RE.test('뭘 자꾸 가래'))
const mk = (conversationId, messageId, idx, min, text, extra = {}) => ({ conversationId, messageId, idx, createdAt: min * 60000, text, tokenEstimate: 10, hasAttachment: false, prevAssistantIdx: idx - 1, ...extra })
const inputs = [
  mk('x', '1', 0, 0, '로그인 기능 구현해줘'),
  mk('x', '2', 2, 5, '아까 말했듯이 로그인 기능 구현해줘'),           // 높음
  mk('x', '3', 4, 7, '로그인 기능 구현해줘 그리고 테스트도'),       // 재전송(접두어, 2분)
  mk('x', '4', 6, 9, '휴학을 하는게 맞지?'),                           // 질문형 → 반복 질문
  mk('x', '5', 8, 20, '로그인 기능 구현해줘', { hasAttachment: true }), // 첨부 → 제외
  mk('x', '6', 10, 3000, '로그인 기능 구현해줘'),                      // 48시간 뒤 표지 없음 → stale
  mk('y', '7', 0, 0, '수정해줘'), mk('y', '8', 2, 1, '수정해줘'),
  mk('z', '9', 0, 0, '수정해줘'), mk('z', '10', 2, 1, '수정해줘'),
  mk('w', '11', 0, 0, '수정해줘'), mk('w', '12', 2, 1, '수정해줘'),     // 3개 대화 이상 → 범용
  mk('v', '13', 0, 0, '혼자'),
]
// 벡터: 로그인 계열은 0도 근처, 휴학은 0도(앞선 발화와 유사하게 강제), 수정해줘는 90도, 혼자는 180도
const deg = { '1': 0, '2': 2, '3': 0, '4': 3, '5': 0, '6': 0, '7': 90, '8': 90, '9': 90, '10': 90, '11': 90, '12': 90, '13': 180 }
const vec = (i) => unit(deg[inputs[i].messageId])
const nullSims = nullDistribution(inputs, vec, 500)
assert.ok(nullSims.length > 0 && nullSims.every((s, k) => k === 0 || s >= nullSims[k - 1]), '정렬된 귀무분포')
const pairs = detect(inputs, vec, { nullThreshold: 0.99, resendMinutes: 10, resendEditRatio: 0.15, genericConversations: 3, staleHours: 24 })
const by = Object.fromEntries(pairs.map((p) => [p.messageId, p]))
assert.equal(by['2'].grade, 'high')
assert.equal(by['3'].exclusion, 'resend')
assert.equal(by['4'].exclusion, 'not_instruction'); assert.equal(by['4'].kind, 'question')
assert.equal(by['5'].exclusion, 'attachment')
assert.equal(by['6'].exclusion, 'stale')
assert.equal(by['8'].exclusion, 'generic'); assert.equal(by['10'].exclusion, 'generic')
const sum = summarize(pairs, inputs, 0.99)
assert.equal(sum.byGrade.high, 1); assert.equal(sum.repeatedQuestions, 1); assert.equal(sum.judgeable, 12)
console.log('detector ok', sum.excluded)
