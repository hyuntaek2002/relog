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
const { detect, summarize, nullDistribution, quantile, kindOf, editRatio, REPEAT_RE, COMPLAINT_RE, DEFAULT_OPTIONS } = await import('../web/src/detect/detector.ts')
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
const pairs = detect(inputs, vec, { ...DEFAULT_OPTIONS, nullThreshold: 0.99 })
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

// 처방 엔진: 필터·점수·상한·"이미 씀" 제외
const { recommend, scoreAll, genericDefaults, CATALOG } = await import('../web/src/recommend/recommend.ts')
const verifiedCount = CATALOG.filter((c) => c.verified).length
assert.ok(verifiedCount >= 15, `verified ${verifiedCount} >= 15`)
assert.ok(CATALOG.filter((c) => c.verified && c.category !== 'practice').every((c) => c.evidenceUrl && c.verifiedAt), 'verified 항목은 evidenceUrl·verifiedAt 필수')
const snap = {
  platform: 'claude',
  taskShare: { coding: 0.1, writing: 0.3, learning: 0.05, workdoc: 0.2, search: 0.05, ideation: 0.1, translation: 0.05, counseling: 0.15 },
  taskCounts: {}, userTurnCount: 500, conversationCount: 15, longConversationShare: 0.5, avgTurnsPerConversation: 33, codeShare: 0, hourHistogram: new Array(24).fill(0),
  restatement: { high: 1, mid: 20, low: 2, misunderstanding: 10, repeatedQuestion: 60, perTask: { workdoc: 8 }, tokenEstimate: 8000, ratio: 16 },
}
const r1 = recommend(snap, { plan: 'pro', featuresInUse: [] })
assert.ok(r1.length >= 1 && r1.length <= 3, '0~3개')
assert.ok(r1.every((p) => /\d/.test(p.why)), 'why에 수치 포함')
assert.ok(r1.every((p) => !/낭비|잊었|확실히 개선/.test(p.why + p.what + p.how + p.caveat)), '금지어 없음')
const cats = r1.map((p) => p.category)
assert.ok(cats.every((c) => cats.filter((x) => x === c).length <= 2), 'category당 최대 2개')
assert.ok(r1[0].grade === '핵심', '문제 신호 있으면 핵심')
// 이미 씀 → 다음 실행에서 제외
const first = r1[0].catalogId
const r2 = recommend(snap, { plan: 'pro', featuresInUse: [] }, { [first]: 'already_using' })
assert.ok(!r2.some((p) => p.catalogId === first), '"이미 씀" 항목 제외')
// 요금제 필터: free면 chat_search(pro+) 탈락
const sc = scoreAll(snap, { plan: 'free', featuresInUse: [] })
assert.ok(sc.find((s) => s.item.id === 'cl_chat_search').excluded?.startsWith('요금제'))
assert.ok(sc.find((s) => s.item.id === 'cg_projects').excluded === '플랫폼 불일치')
assert.ok(sc.filter((s) => s.excluded === '미검증').length >= 1)
// 문제 신호 없는 스냅샷 → 과업 신호만으로는 참고 등급
const calm = { ...snap, longConversationShare: 0, avgTurnsPerConversation: 3, restatement: { high: 0, mid: 0, low: 0, misunderstanding: 0, repeatedQuestion: 0, perTask: {}, tokenEstimate: 0, ratio: 0 } }
const r3 = recommend(calm, { plan: 'pro', featuresInUse: [] })
assert.ok(r3.every((p) => p.grade === '참고'), '문제 신호 없으면 참고만')
assert.equal(genericDefaults('claude').length, 3)
console.log('recommend ok', r1.map((p) => `${p.catalogId}:${p.grade}:${p.score}`))

// 기능 자동 감지: 도구 이름 → 카탈로그 id, 대화 수 집계
const { detectFeatures } = await import('../web/src/recommend/detectFeatures.ts')
const conv = (id, toolNames) => ({ id, platform: 'claude', title: '', createdAt: null, turns: [], toolNames })
const det = detectFeatures([conv('a', ['WebSearch', 'Bash', 'WebFetch']), conv('b', ['web_search', 'mcp__claude-artifacts__publish_files', 'Skill']), conv('c', ['integration:Google Drive']), conv('d', [])])
assert.deepEqual(det, [{ catalogId: 'cl_web_search', conversations: 2 }, { catalogId: 'cl_artifacts', conversations: 1 }, { catalogId: 'cl_skills', conversations: 1 }, { catalogId: 'cl_connectors_google', conversations: 1 }])
console.log('detectFeatures ok')

{
// 발화 대장·주 단위 집계: 해시 키, 편집 덮어쓰기, 주 버킷, 비율
const { contentHash, buildLedger, aggregateWeekly, mergeLedger, weekStart, versionKey } = await import('../web/src/store/ledger.ts')
assert.equal(contentHash('abc').length, 16)
assert.notEqual(contentHash('abc'), contentHash('abd'))
const ver = { parserVersion: 'p', normalizerVersion: 'n', modelVersion: 'm', classifierVersion: 'c', detectorVersion: 'd', catalogVersion: 'k', recommendationRuleVersion: 'r' }
const vk = versionKey(ver)
const MON = new Date(2026, 10, 2, 10).getTime() // 2026-11-02 월요일 10시(로컬)
assert.equal(new Date(weekStart(MON + 3 * 86400000)).getDay(), 1, '주 시작은 월요일')
const mkU = (conv, id, text, dayOffset, status = 'ok', hasCode = false) => ({ conversationId: conv, messageId: id, idx: 0, createdAt: MON + dayOffset * 86400000, text, status, hasCode, codeLangs: [], truncated: false, hasAttachment: false, tokenEstimate: 5, prevAssistantIdx: -1 })
const lu = [mkU('c1', 'a', '첫', 0), mkU('c1', 'b', '둘', 1), mkU('c1', 'c', '셋', 8), mkU('c2', 'd', '홀로', 2), mkU('c2', 'e', '응', 2, 'skipped')]
const okIds = lu.filter((u) => u.status === 'ok').map((u) => u.messageId)
const preds = okIds.map(() => ({ type: 'coding', score: 1 }))
const pairs = [{ conversationId: 'c1', messageId: 'b', priorMessageId: 'a', similarity: 0.95, kind: 'instruction', repeatMarker: true, complaintMarker: false, gapMinutes: 1, responseBetween: true, grade: 'high', exclusion: null, tokenEstimate: 5 }]
const led = buildLedger({ platform: 'claude', utterances: lu, okIds, preds, pairs, version: ver, analyzedAt: 1 })
assert.equal(led.length, 5)
assert.equal(led.find((e) => e.messageId === 'b').grade, 'high')
let weeks = aggregateWeekly(led, vk)
assert.equal(weeks.length, 2, '2주 버킷')
assert.deepEqual([weeks[0].userTurnCount, weeks[0].okCount, weeks[0].judgeable, weeks[0].conversationCount], [4, 3, 2, 2], '1주차: 발화 4(제외 포함), ok 3, 판단 가능 2(c1만), 대화 2')
assert.equal(weeks[0].restatement.high, 1)
assert.equal(weeks[0].restatement.ratio, 50, '1/2 × 100')
assert.equal(weeks[1].userTurnCount, 1)
// 편집된 메시지(같은 messageId, 다른 해시)는 새 항목으로 들어가되 집계는 최신 것만
const edited = buildLedger({ platform: 'claude', utterances: [mkU('c1', 'b', '둘(수정)', 1)], okIds: ['b'], preds: [{ type: 'writing', score: 1 }], pairs: [], version: ver, analyzedAt: 2 })
const merged = mergeLedger(led, edited)
assert.equal(merged.length, 6, '해시가 달라 새 키')
weeks = aggregateWeekly(merged, vk)
assert.equal(weeks[0].taskCounts.writing, 1); assert.equal(weeks[0].taskCounts.coding, 2); assert.equal(weeks[0].restatement.high, 0, '최신 분석엔 후보 없음')
// 같은 키 재전송 = 덮어쓰기
assert.equal(mergeLedger(led, led).length, 5)
// 다른 버전은 집계에서 제외
assert.equal(aggregateWeekly(led, 'other').length, 0)
console.log('ledger ok')
}
