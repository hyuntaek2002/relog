// 파서 자가 점검. 사용: node eval/test_parser.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
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
assert.deepEqual({ ...s, userTokenEstimate: 0, assistantTokenEstimate: 0 }, { conversations: 3, assistantTokenEstimate: 0, userTurns: 15, assistantTurns: 15, longConversations: 1, judgeableUserTurns: 14, userTokenEstimate: 0, firstAt: (1760000000 + 60) * 1000, lastAt: (1760000000 + 90 * 12) * 1000 })
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
assert.ok(REPEAT_RE.test('왜 빠졌어') && REPEAT_RE.test('한국어로 하라고 했잖아') && !REPEAT_RE.test('로그인 구현해줘'))
assert.ok(COMPLAINT_RE.test('궁금해서 물어보는거라니까') && COMPLAINT_RE.test('뭘 자꾸 가래'))
// det-0.4: 반복이 아닌 뜻으로 쓰인 표지는 잡지 않는다(실제 대화에서 틀린 경우를 합성 문장으로 옮김)
for (const s of ['다 풀었는데 같은 문제가 나오네, 다른 문제도 내줘', '그 부분 다시 말해줘', '아까 말했던 기능 이제 구현하자']) assert.ok(!REPEAT_RE.test(s), s)
// det-0.5: 사실 확인 "했잖아", 새 요청의 "다시 한번", 서수 "몇번째", 남의 말 전달 "~하자고 했어/~하라고 했던"은 표지가 아니다
for (const s of ['어제 회의 했잖아. 요약해봐', '다시 한번 확인하고 수정해줘', '몇번째 줄인지 알려줘', '친구가 같이 가자고 했어', '선생님이 제출하라고 했던 숙제야', '이것이 상위 개념이라고 했습니다', '늦었다고 말하지 마세요', '빌드했는데 여전히 같은 메시지가 떠']) assert.ok(!REPEAT_RE.test(s), s)
for (const s of ['아까 말한 대로 표로 정리해', '아까 말했듯이 존댓말로', '다시 말하지만 존댓말로 써', '또 같은 오류가 나잖아', '내가 삭제하라고 했잖아', '몇 번을 말해야 돼', '이거 몇 번째 말하는 거야', '표로 쓰라고 했지', '내가 그건 필요 없다했잖아', '내가 어제 형식 정리 했잖아']) assert.ok(REPEAT_RE.test(s), s)
{ // 표지는 본인 말에서만: 따옴표 안 인용과 긴 붙여넣기 가운데는 보지 않는다
  const { ownWords } = await import('../web/src/detect/detector.ts')
  assert.ok(!REPEAT_RE.test(ownWords('반복 표지("아까 말했", "했잖아")를 이렇게 바꿔줘')))
  const paste = '가'.repeat(200) + ' 몇 번을 말해야 돼 ' + '나'.repeat(200)
  assert.ok(!REPEAT_RE.test(ownWords(paste)), '긴 글 가운데 표지는 무시')
  assert.ok(REPEAT_RE.test(ownWords('가'.repeat(400) + ' 내가 삭제하라고 했잖아')), '긴 글 끝의 본인 말은 본다')
}
// 코드가 대부분인 메시지는 지시문으로 보지 않는다. 코드와 함께 긴 한국어 항의를 쓴 메시지는 지시문
assert.equal(kindOf('import java.util.List; public class A { void f() { return; } } // 여전히 수정'), 'other')
assert.equal(kindOf('function go() { location.href = "/a"; } 이건 어디에 넣어?'), 'other')
assert.equal(kindOf("import A from './A'; import B from './B'; 내가 이 파일은 없다고 했잖아, 있는 파일로만 다시 고쳐서 줘"), 'instruction')
const mk = (conversationId, messageId, idx, min, text, extra = {}) => ({ conversationId, messageId, idx, createdAt: min * 60000, text, tokenEstimate: 10, hasAttachment: false, prevAssistantIdx: idx - 1, ...extra })
const inputs = [
  mk('x', '1', 0, 0, '로그인 기능 구현해줘'),
  mk('x', '2', 2, 5, '아까 말했듯이 로그인 기능 구현해줘'),           // 높음
  mk('x', '3', 4, 7, '로그인 기능 구현해줘 그리고 테스트도'),       // 재전송(접두어, 2분)
  mk('x', '4', 6, 9, '휴학을 하는게 맞지?'),                           // 질문형 → 반복 질문
  mk('x', '5', 8, 20, '로그인 기능 구현해 주세요', { hasAttachment: true }), // 첨부 → 제외
  mk('x', '6', 10, 3000, '로그인 기능 만들어줘'),                      // 48시간 뒤 표지 없음 → stale
  mk('x', '14', 12, 3030, '로그인 기능 만들어줘'),                     // 글자까지 같은 지시, 30분 뒤 → 정기 명령(routine)
  mk('x', '15', 14, 3060, '푸시한 다음 배포해 주세요'),                        // 짧은 정기 작업 명령 → routine
  mk('x', '16', 16, 3090, '다음 단계 진행해 주세요'),         // 진행 명령 → routine
  mk('y', '7', 0, 0, '수정해줘'), mk('y', '8', 2, 1, '수정해줘'),
  mk('z', '9', 0, 0, '수정해줘'), mk('z', '10', 2, 1, '수정해줘'),
  mk('w', '11', 0, 0, '수정해줘'), mk('w', '12', 2, 1, '수정해줘'),     // 3개 대화 이상 → 범용
  mk('v', '13', 0, 0, '혼자'),
]
// 벡터: 로그인 계열은 0도 근처, 휴학은 0도(앞선 발화와 유사하게 강제), 수정해줘는 90도, 혼자는 180도
const deg = { '1': 0, '2': 2, '3': 0, '4': 3, '5': 0, '6': 6, '14': 6, '15': 0, '16': 0, '7': 90, '8': 90, '9': 90, '10': 90, '11': 90, '12': 90, '13': 180 }
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
assert.equal(by['14'].exclusion, 'routine'); assert.equal(by['15'].exclusion, 'routine'); assert.equal(by['16'].exclusion, 'routine')
assert.equal(by['8'].exclusion, 'generic'); assert.equal(by['10'].exclusion, 'generic')
const sum = summarize(pairs, inputs, 0.99)
assert.equal(sum.byGrade.high, 1); assert.equal(sum.repeatedQuestions, 1); assert.equal(sum.judgeable, 15); assert.equal(sum.excluded.routine, 3)
console.log('detector ok', sum.excluded)

// 설치 플러그인 매칭: 표시 이름과 id를 느슨하게
{
  const { installedPlugins, isInstalled } = await import('../web/src/recommend/taskPluginRules.ts')
  const inst = installedPlugins([{ pluginNames: ['unity', 'engineering'] }, { pluginNames: ['caveman'] }, {}])
  assert.deepEqual(inst, ['caveman', 'engineering', 'unity'])
  assert.ok(isInstalled('Engineering', inst) && isInstalled('Unity', inst) && isInstalled('Caveman Mode: Short Answers', inst))
  assert.ok(!isInstalled('UI Design Review', inst) && !isInstalled('', inst))
  console.log('installed plugins ok')
}

// 묶음별 기준: 같은 발화라도 묶음 기준이 높으면 후보에서 빠지고, 묶음 기준이 없는 발화는 전체 기준을 쓴다
{
  const gIn = [mk('g1', 'a1', 0, 0, '로그인 기능 구현해줘', { group: 'code' }), mk('g1', 'a2', 2, 5, '로그인 화면 다시 손봐줘', { group: 'code' }), mk('g2', 'b1', 0, 0, '로그인 기능 구현해줘'), mk('g2', 'b2', 2, 5, '로그인 화면 다시 손봐줘')]
  const gVec = (i) => unit({ a1: 0, a2: 5, b1: 0, b2: 5 }[gIn[i].messageId])
  const gp = detect(gIn, gVec, { ...DEFAULT_OPTIONS, nullThreshold: 0.9, groupThreshold: { code: 0.999 } })
  const g = Object.fromEntries(gp.map((p) => [p.messageId, p]))
  assert.equal(g.a2.exclusion, 'below_null'); assert.equal(g.b2.grade, 'medium')
  const gs = summarize(gp, gIn, 0.9, { code: 0.999 })
  assert.deepEqual(gs.groupThreshold, { code: 0.999 }); assert.equal(gs.byGrade.medium, 1)
  console.log('group threshold ok')
}

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

// 과업별 전후 비교
{
  const { compareTasks } = await import('../web/src/store/ledger.ts')
  const wk = (start, taskCounts, perTask, high = 0, medium = 0) => ({ periodStart: start, periodEnd: start + 7 * 86400000, versionKey: 'v', platform: 'claude', userTurnCount: 0, okCount: 0, judgeable: 0, conversationCount: 0, longConversationCount: 0, codeCount: 0, taskCounts, restatement: { high, medium, low: 0, tokenEstimate: 0, ratio: 0, perTask, repeatedQuestion: 0, misunderstanding: 0 }, hourHistogram: [] })
  const weeks = [
    // det-0.4.1: perTask와 전체 건수는 확실함만. 가능성 있음(medium)은 세지 않는다
    wk(0, { coding: 10, writing: 5 }, { coding: 4 }, 4, 3),
    wk(7 * 86400000, { coding: 10 }, { coding: 2 }, 2, 2),
    wk(14 * 86400000, { coding: 10, writing: 2 }, { coding: 1 }, 1, 5),
    wk(21 * 86400000, { coding: 10 }, {}, 0, 0),
  ]
  const c = compareTasks(weeks, 2)
  assert.deepEqual(c.beforeRange, [0, 14 * 86400000]); assert.deepEqual(c.afterRange, [14 * 86400000, 28 * 86400000])
  const coding = c.rows.find((r) => r.task === 'coding')
  assert.deepEqual([coding.before.ok, coding.before.flagged, coding.before.ratio], [20, 6, 30])
  assert.deepEqual([coding.after.ok, coding.after.flagged, coding.after.ratio], [20, 1, 5])
  assert.equal(coding.delta, -25)
  const writing = c.rows.find((r) => r.task === 'writing')
  assert.equal(writing.after.ratio, null, '표본 5개 미만이면 비율 없음'); assert.equal(writing.delta, null)
  assert.equal(c.total.before.flagged, 6); assert.equal(c.total.after.flagged, 1)
  assert.equal(c.rows[0].task, 'coding', '발화 많은 순')
  console.log('compare ok')
}

// 결과 파일 왕복 + 두 묶음 비교
{
  const { compareSides } = await import('../web/src/store/ledger.ts')
  const { buildReport, parseReport, REPORT_FORMAT } = await import('../web/src/store/report.ts')
  const wk = (start, taskCounts, perTask, medium = 0) => ({ periodStart: start, periodEnd: start + 7 * 86400000, versionKey: 'v', platform: 'claude', userTurnCount: 0, okCount: 0, judgeable: 0, conversationCount: 0, longConversationCount: 0, codeCount: 0, taskCounts, restatement: { high: 0, medium, low: 0, tokenEstimate: 0, ratio: 0, perTask, repeatedQuestion: 0, misunderstanding: 0 }, hourHistogram: [] })
  const snapshot = { platform: 'claude', taskShare: {}, taskCounts: {}, userTurnCount: 1, conversationCount: 1, longConversationShare: 0, avgTurnsPerConversation: 1, codeShare: 0, hourHistogram: [1, 2], restatement: { high: 0, mid: 0, low: 0, misunderstanding: 0, repeatedQuestion: 0, perTask: {}, tokenEstimate: 0, ratio: 0 } }
  const version = { parserVersion: 'p', normalizerVersion: 'n', modelVersion: 'm', classifierVersion: 'c', detectorVersion: 'd', catalogVersion: 'k', recommendationRuleVersion: 'r' }
  const oldWeeks = [wk(0, { coding: 10, writing: 10 }, { coding: 4, writing: 1 }, 5)]
  const rep = parseReport(JSON.stringify(buildReport(snapshot, oldWeeks, version)))
  assert.equal(rep.format, REPORT_FORMAT); assert.equal(rep.snapshot.hourHistogram, undefined, '시간대 분포는 넣지 않음'); assert.equal(rep.weeks.length, 1)
  assert.throws(() => parseReport('{"format":"other"}'), /결과 파일이 아닙니다/)
  assert.throws(() => parseReport('not json'), /JSON/)
  const c = compareSides(rep.weeks, [wk(7 * 86400000, { coding: 10, writing: 10 }, { coding: 1, writing: 3 }, 4)])
  assert.equal(c.rows.find((r) => r.task === 'coding').delta, -30, '코딩 줄어듦')
  assert.equal(c.rows.find((r) => r.task === 'writing').delta, 20, '글쓰기 늘어남')
  console.log('report ok')
}

// 대화 종류별 플러그인: 기준 미만은 데이터 부족, 상담·대화는 맞는 플러그인 없음
{
  const { resolveTaskPlugins, TASK_PLUGIN_MIN_MESSAGES } = await import('../web/src/recommend/taskPluginRules.ts')
  const rows = resolveTaskPlugins({ taskCounts: { coding: 36, writing: 118, learning: 27, workdoc: 90, search: 5, ideation: 50, translation: 14, counseling: 153 }, taskShare: { coding: 0.07, writing: 0.24, learning: 0.05, workdoc: 0.18, search: 0.01, ideation: 0.1, translation: 0.03, counseling: 0.31 } })
  assert.equal(rows.length, 8); assert.equal(rows[0].task, 'counseling', '많이 쓴 순')
  assert.equal(rows[0].status, 'none')
  const by = Object.fromEntries(rows.map((r) => [r.task, r]))
  assert.equal(by.translation.status, 'insufficient'); assert.ok(14 < TASK_PLUGIN_MIN_MESSAGES)
  assert.equal(by.search.status, 'insufficient')
  assert.equal(by.writing.status, 'recommend'); assert.equal(by.writing.pick.name, 'Humanizer'); assert.ok(by.writing.how.includes("'Humanizer'"))
  assert.ok(rows.filter((r) => r.status === 'recommend').every((r) => r.pick.evidenceUrl !== '' || r.pick.maker === 'Anthropic'), '근거 URL 또는 Anthropic 제공')
  assert.ok(!rows.some((r) => /낭비|잊었|확실히 개선/.test((r.pick?.oneLiner ?? '') + (r.alt?.oneLiner ?? ''))))
  // ChatGPT: 종류별 첫 후보와 디렉터리 링크, ChatGPT용 설치 방법
  const snap = { taskCounts: { coding: 40, writing: 0, learning: 0, workdoc: 0, search: 0, ideation: 0, translation: 0, counseling: 30 }, taskShare: {} }
  const cg = Object.fromEntries(resolveTaskPlugins(snap, TASK_PLUGIN_MIN_MESSAGES, 'chatgpt').map((r) => [r.task, r]))
  assert.equal(cg.coding.pick.name, 'GitHub'); assert.ok(cg.coding.pick.evidenceUrl.startsWith('https://chatgpt.com/plugins/plugin_'))
  assert.equal(cg.counseling.status, 'none'); assert.ok(cg.coding.how.includes("'GitHub'") && cg.coding.how.includes('사이드바'))
  assert.ok(Object.values(cg).every((r) => !r.pick || r.pick.oneLiner), '모든 ChatGPT 후보에 한국어 한 줄')
  // 평가 전용 맞춤(eval/recommend): 평소 유사도(m·d)로 표준화한 점수
  const { bestAmong, Q_SCALE } = await import('./recommend/pluginMatch.ts')
  const q = new Float32Array([1, 0]), vecs = new Int8Array([127, 0, 90, 90, 0, 127])
  const meta = [{ n: 'a', m: 0.24, d: 0.01 }, { n: 'b', m: 0.0, d: 0.05 }, { n: 'c', m: 0, d: 1 }]
  assert.equal(bestAmong(q, vecs, meta, [0, 1, 2]).plugin, 1, '유사도는 a가 높아도 평소에도 높으면 밀린다'); assert.ok(Q_SCALE > 0)
  assert.equal(bestAmong(q, vecs, meta, []), null)
  console.log('taskPlugins ok')
}

// Claude Code 세션(.jsonl): 사람 입력만 user 턴, 도구 결과·메타·시스템 주입·하위 에이전트 제외, 답변 블록 병합, 도구 이름 수집
{
  const { parseClaudeCodeSession } = await import('../web/src/parser/claudeCode.ts')
  const L = (o) => JSON.stringify(o)
  const base = { sessionId: 'sess-1', cwd: String.raw`C:\Dev\demo`, userType: 'external', entrypoint: 'claude-desktop' }
  const lines = [
    L({ type: 'queue-operation', sessionId: 'sess-1' }),
    L({ ...base, type: 'user', uuid: 'u1', timestamp: '2026-11-01T01:00:00Z', message: { role: 'user', content: '첫 요청입니다' } }),
    L({ ...base, type: 'assistant', uuid: 'a1', timestamp: '2026-11-01T01:00:05Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: '답변 1부' }] } }),
    L({ ...base, type: 'assistant', uuid: 'a2', timestamp: '2026-11-01T01:00:06Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } }),
    L({ ...base, type: 'user', uuid: 'u2', timestamp: '2026-11-01T01:00:07Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ls 결과' }] } }),
    L({ ...base, type: 'assistant', uuid: 'a3', timestamp: '2026-11-01T01:00:08Z', message: { role: 'assistant', content: [{ type: 'text', text: '답변 2부' }, { type: 'tool_use', name: 'Edit', input: {} }, { type: 'tool_use', name: 'Skill', input: { skill: 'artifact-design' } }, { type: 'tool_use', name: 'Skill', input: { skill: 'anthropic-skills:pdf' } }, { type: 'tool_use', name: 'Skill', input: { skill: 'ponytail:ponytail' } }] } }),
    L({ type: 'attachment', uuid: 'at1', sessionId: 'sess-1', attachment: { type: 'x', content: 'The following skills are available for use with the Skill tool:\n\n- anthropic-skills:docs: 설명\n- unity:ui-uitk: 설명\n- engineering:code-review: 설명\n- unity:localization: 설명' } }),
    L({ ...base, type: 'user', uuid: 'u3', isMeta: true, timestamp: '2026-11-01T01:00:09Z', message: { role: 'user', content: '<local-command-caveat>메타</local-command-caveat>' } }),
    L({ ...base, type: 'user', uuid: 'u4', promptSource: 'system', origin: { kind: 'task-notification' }, timestamp: '2026-11-01T01:00:10Z', message: { role: 'user', content: '<task-notification>끝남</task-notification>' } }),
    L({ ...base, type: 'user', uuid: 'u5', isSidechain: true, timestamp: '2026-11-01T01:00:11Z', message: { role: 'user', content: '하위 에이전트 지시' } }),
    L({ ...base, type: 'user', uuid: 'u6', timestamp: '2026-11-01T01:01:00Z', message: { role: 'user', content: [{ type: 'image', source: {} }, { type: 'text', text: '<pasted_content id="1">붙여 넣은 글</pasted_content> 이거 고쳐' }] } }),
    L({ type: 'custom-title', customTitle: '데모 작업', sessionId: 'sess-1' }),
    '{깨진 줄',
  ]
  const c = parseClaudeCodeSession(lines.join('\n'), 'projects/C--Dev-demo/sess-1.jsonl')
  assert.equal(c.id, 'sess-1'); assert.equal(c.platform, 'claude'); assert.equal(c.client, 'code'); assert.equal(c.title, '데모 작업')
  assert.deepEqual(c.turns.map((t) => t.role), ['user', 'assistant', 'user'], '도구 결과·메타·시스템·하위 에이전트 제외, 답변 병합')
  assert.equal(c.turns[1].text, '답변 1부\n답변 2부')
  assert.equal(c.turns[2].text, '붙여 넣은 글 이거 고쳐'); assert.equal(c.turns[2].hasAttachment, true)
  assert.deepEqual(c.toolNames.sort(), ['Bash', 'Edit', 'Skill'])
  assert.deepEqual(c.pluginNames, ['engineering', 'ponytail', 'unity'], '스킬 목록 + Skill 호출 접두어, 내장(anthropic-skills)·접두어 없는 호출 제외')
  assert.equal(c.createdAt, Date.parse('2026-11-01T01:00:00Z'))
  assert.equal(parseClaudeCodeSession([lines[4]].join('\n'), 'x.jsonl'), null, '사람 입력 없으면 null')
  const noTitle = parseClaudeCodeSession([lines[1]].join('\n'), 'y.jsonl'); assert.equal(noTitle.title, 'demo (Claude Code)')
  console.log('claude code ok')
}

// 코딩 세부 분류(대화 단위 키워드)와 Claude Code 메시지 코딩 고정
{
  const { codingSubtype, pinCodeToCoding, subByConversation } = await import('../web/src/classify/codingSub.ts')
  const { codingSubPlugin } = await import('../web/src/recommend/taskPluginRules.ts')
  const conv = (id, client, title, texts, tools = []) => ({ id, platform: 'claude', client, title, createdAt: null, toolNames: tools, turns: texts.map((text, i) => ({ idx: i, role: 'user', text, createdAt: null, messageId: id + ':' + i, tokenEstimate: 1, hasAttachment: false })) })
  const game = conv('g', 'code', 'minigame (Claude Code)', ['유니티에서 프리팹이 안 보여', '스프라이트 애니메이션 고쳐줘', '캐릭터 점프 구현'])
  const web = conv('w', 'code', 'relog', ['React 컴포넌트 버튼 레이아웃 고쳐', 'css 정렬이 이상해', '화면에 표가 안 보여'])
  const vague = conv('v', 'code', 'x', ['이거 고쳐', '다시 해봐'])
  const app = conv('a', undefined, '글쓰기', ['이 문단 교정해줘'])
  assert.equal(codingSubtype(game), 'game'); assert.equal(codingSubtype(web), 'web'); assert.equal(codingSubtype(vague), 'other', '키워드 2개 미만은 기타')
  const okUtts = [{ conversationId: 'g', messageId: 'g:0' }, { conversationId: 'a', messageId: 'a:0' }]
  const pinned = pinCodeToCoding([{ type: 'writing', score: 0.9 }, { type: 'writing', score: 0.9 }], okUtts, [game, app])
  assert.deepEqual(pinned.map((p) => p.type), ['coding', 'writing'], 'Code 세션만 코딩으로 고정')
  const subs = subByConversation([game, web, vague, app]); assert.deepEqual([subs.g, subs.w, subs.v], ['game', 'web', 'other'])
  assert.equal(codingSubPlugin('game', 25).pick.name, 'Unity'); assert.equal(codingSubPlugin('game', 5), null, '기준 미만'); assert.equal(codingSubPlugin('server', 100), null, '정해진 플러그인 없음')
  console.log('coding sub ok')
}

// 갈라진 세션: 같은 메시지 uuid는 턴이 많은 세션에만 남긴다
{
  const { dedupeForkedSessions } = await import('../web/src/parser/claudeCode.ts')
  const T = (id, role, text) => ({ idx: 0, role, text, createdAt: null, messageId: id, tokenEstimate: 1, hasAttachment: false })
  const short = { id: 's', platform: 'claude', client: 'code', title: '', createdAt: null, toolNames: [], turns: [T('m1', 'user', 'a'), T('r1', 'assistant', 'b')] }
  const long = { id: 'l', platform: 'claude', client: 'code', title: '', createdAt: null, toolNames: [], turns: [T('m1', 'user', 'a'), T('r1', 'assistant', 'b'), T('m2', 'user', 'c')] }
  const app = { id: 'p', platform: 'claude', title: '', createdAt: null, toolNames: [], turns: [T('m1', 'user', 'a')] }
  const out = dedupeForkedSessions([short, long, app])
  assert.deepEqual(out.map((c) => c.id), ['l', 'p'], '사람 입력이 안 남은 짧은 세션은 제거, 앱 대화는 손대지 않음')
  assert.equal(out[0].turns.length, 3, "중복을 가져간 쪽은 그대로")
  const mid = { id: "m", platform: "claude", client: "code", title: "", createdAt: null, toolNames: [], turns: [T("m1", "user", "a"), T("r1", "assistant", "b"), T("m3", "user", "d")] }
  const long2 = { ...long, turns: [...long.turns, T("r2", "assistant", "e")] }
  const out2 = dedupeForkedSessions([mid, long2])
  assert.deepEqual(out2.find((c) => c.id === "m").turns.map((t) => t.messageId + ":" + t.idx), ["r1:0", "m3:1"], "겹친 메시지만 빠지고 idx 재부여")
  console.log('fork dedupe ok')
}

// 답변 분량 신호: 평균 800토큰 또는 5배 이상이면 간결 답변 플러그인에 문제 신호가 붙는다
{
  const { scoreAll } = await import('../web/src/recommend/recommend.ts')
  const { basicStats } = await import('../web/src/parser/stats.ts')
  const T = (role, n) => ({ idx: 0, role, text: 'x', createdAt: null, messageId: role + n, tokenEstimate: n, hasAttachment: false })
  const st = basicStats([{ id: 'c', platform: 'claude', title: '', createdAt: null, toolNames: [], turns: [T('user', 50), T('assistant', 900), T('user', 50), T('assistant', 1100)] }])
  assert.equal(st.assistantTokenEstimate, 2000); assert.equal(st.userTokenEstimate, 100)
  const base = { platform: 'claude', taskShare: {}, taskCounts: {}, userTurnCount: 2, conversationCount: 1, longConversationShare: 0, avgTurnsPerConversation: 2, codeShare: 0, codingSub: {}, hourHistogram: [], restatement: { high: 0, mid: 0, low: 0, misunderstanding: 0, repeatedQuestion: 0, perTask: {}, tokenEstimate: 0, ratio: 0 } }
  const ctx = { plan: 'pro', featuresInUse: [], goals: [], ignored: [] }
  const hot = scoreAll({ ...base, answer: { avgTokens: 1000, ratio: 20 } }, ctx).find((x) => x.item.id === 'cl_plugin_concise')
  assert.ok(hot.problemHits.some((h) => h.includes('1000토큰')) && hot.problemHits.some((h) => h.includes('20.0배')), hot.problemHits.join())
  const calm = scoreAll({ ...base, answer: { avgTokens: 300, ratio: 3 } }, ctx).find((x) => x.item.id === 'cl_plugin_concise')
  assert.equal(calm.problemHits.length, 0)
  console.log('answer signal ok')
}

// 플러그인 찾기: 검색어 조각 모두 포함 + 카테고리 slug 필터, 설치 수 표기
{
  const { filterPlugins, fmtInstalls } = await import('../web/src/recommend/pluginSearchRules.ts')
  const list = [{ n: 'Humanizer', s: 'Rewrite AI-sounding text', r: '', c: ['writing'], i: 38800, a: false, k: 'AI 티가 나는 문장을 고칩니다.' }, { n: 'github', s: 'Official GitHub MCP server', r: '', c: ['engineering', 'code'], i: 1200000, a: false }, { n: 'Nocat', s: 'no category', r: '', c: [], i: null, a: true }]
  assert.deepEqual(filterPlugins(list, '', '').map((p) => p.n), ['Humanizer', 'github', 'Nocat'])
  assert.deepEqual(filterPlugins(list, 'ai 문장', '').map((p) => p.n), ['Humanizer'], '한국어 설명도 검색')
  assert.deepEqual(filterPlugins(list, 'GITHUB mcp', 'code').map((p) => p.n), ['github'])
  assert.deepEqual(filterPlugins(list, '', 'writing').map((p) => p.n), ['Humanizer'])
  assert.equal(fmtInstalls(38800), '38.8K'); assert.equal(fmtInstalls(1200000), '1.2M'); assert.equal(fmtInstalls(999), '999'); assert.equal(fmtInstalls(null), '')
  const file = JSON.parse(fs.readFileSync(new URL('../web/public/plugins-2026-11-10.json', import.meta.url), 'utf8'))
  assert.equal(file.format, 'relog-plugins-1'); assert.ok(file.plugins.length > 3000 && Object.keys(file.categories).length === 57)
  assert.ok(file.plugins.every((p) => p.n && Array.isArray(p.c)), '모든 항목에 이름·카테고리 배열')
  console.log('plugin search ok', file.plugins.length, '개, 카테고리 있는 항목', file.plugins.filter((p) => p.c.length).length, '한국어 설명', file.plugins.filter((p) => p.k).length)
}

// 사용자 보정("반복 아님"): 고친 메시지는 등급이 빠지고 건수·분량·비율이 다시 계산된다
{
  const { applyDismissed } = await import('../web/src/detect/corrections.ts')
  const P = (messageId, grade, tokenEstimate = 10) => ({ conversationId: 'c', messageId, priorMessageId: 'p', similarity: 0.95, kind: 'instruction', repeatMarker: false, complaintMarker: false, gapMinutes: 5, responseBetween: true, grade, exclusion: grade ? null : 'below_null', tokenEstimate })
  const pairs = [P('a', 'high', 30), P('b', 'medium', 20), P('c', 'medium', 10), P('d', null)]
  const summary = { byGrade: { low: 0, medium: 2, high: 1 }, tokenEstimate: 60, judgeable: 20, ratio: 15, repeatedQuestions: 0, misunderstanding: 0, excluded: { below_null: 1 }, nullThreshold: 0.9, groupThreshold: {} }
  const none = applyDismissed(pairs, summary, [])
  assert.equal(none.summary, summary); assert.equal(none.candidates.length, 3); assert.equal(none.dismissedCount, 0)
  const r = applyDismissed(pairs, summary, ['b', 'd', 'zzz'])
  assert.equal(r.dismissedCount, 1, '등급 없는 메시지·없는 id는 무시')
  assert.deepEqual(r.summary.byGrade, { low: 0, medium: 1, high: 1 }); assert.equal(r.summary.tokenEstimate, 30, '분량은 확실함만'); assert.equal(r.summary.ratio, 5, '비율도 확실함만(1/20)')
  assert.equal(r.summary.excluded.user_dismissed, 1); assert.equal(r.pairs[1].grade, null); assert.equal(r.pairs[1].exclusion, 'user_dismissed')
  assert.deepEqual(r.candidates.map((c) => c.messageId), ['a', 'c']); assert.equal(pairs[1].grade, 'medium', '원본은 그대로')
  console.log('corrections ok')
}

// 서버 전송 본문: 숫자·열거형·버전 문자열만 들어가고 글이 들어갈 자리가 없다
{
  const { toDto, toRecommendRequest } = await import('../web/src/store/sync.ts')
  const week = { periodStart: 1, periodEnd: 2, versionKey: 'v', platform: 'claude', userTurnCount: 5, okCount: 4, judgeable: 4, conversationCount: 1, longConversationCount: 0, codeCount: 1, taskCounts: { coding: 4 }, restatement: { high: 0, medium: 1, low: 0, tokenEstimate: 12, ratio: 250, perTask: { coding: 1 }, repeatedQuestion: 0, misunderstanding: 0 }, hourHistogram: new Array(24).fill(0) }
  const ver = { parserVersion: 'p', normalizerVersion: 'n', modelVersion: 'm', classifierVersion: 'c', detectorVersion: 'd', catalogVersion: 'k', recommendationRuleVersion: 'r' }
  const dto = toDto(week, ver)
  assert.equal(dto.restatement.ratio, 100, '비율은 0~100으로 자른다')
  const strings = []
  const walk = (o, path) => { if (typeof o === 'string') strings.push(path); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, path + '.' + k) }
  walk(dto, 'dto')
  assert.deepEqual(strings.sort(), ['dto.analysisVersion.catalogVersion', 'dto.analysisVersion.classifierVersion', 'dto.analysisVersion.detectorVersion', 'dto.analysisVersion.modelVersion', 'dto.analysisVersion.normalizerVersion', 'dto.analysisVersion.parserVersion', 'dto.analysisVersion.recommendationRuleVersion', 'dto.platform'], '문자열 필드는 플랫폼과 버전뿐')
  const snap = { platform: 'claude', taskShare: { coding: 1 }, taskCounts: { coding: 4 }, userTurnCount: 5, conversationCount: 1, longConversationShare: 1.2, avgTurnsPerConversation: 5, codeShare: 0.25, codingSub: {}, answer: { avgTokens: 900, ratio: 6 }, hourHistogram: [], restatement: { high: 0, mid: 1, low: 0, misunderstanding: 0, repeatedQuestion: 0, perTask: { coding: 1 }, tokenEstimate: 12, ratio: 25 } }
  const req = toRecommendRequest(snap, { plan: 'pro', featuresInUse: ['cl_web_search'] })
  assert.equal(req.longConversationShare, 1); assert.equal(req.plan, 'pro'); assert.equal(req.mode, 'personalized'); assert.ok(!('hourHistogram' in req) && !('codingSub' in req))
  console.log('sync dto ok')
}

// 추천 블라인드 평가: 카드 합치기·고정 순서, 평가 파일 왕복, 참여자별 비교와 부호 검정
{
  const { buildCards, buildEvalFile, parseEvalFile, parseFollowupFile, summarizeEval, signTestP, EVAL_FORMAT, FOLLOWUP_FORMAT } = await import('../web/src/recommend/abEval.ts')
  const G = (id) => ({ id, name: id, oneLiner: 'w', howTo30s: '1) {plugin}을 엽니다.' })
  const P = (catalogId) => ({ catalogId, name: catalogId, what: 'w', how: '1) 합니다.' })
  const cards = buildCards([G('g1'), G('g2'), G('x')], [P('p1'), P('x')], 7)
  assert.equal(cards.length, 4, '양쪽에 다 있는 항목은 한 장')
  assert.equal(cards.find((c) => c.catalogId === 'x').source, 'both')
  assert.deepEqual(cards.map((c) => c.order), [1, 2, 3, 4])
  assert.deepEqual(buildCards([G('g1'), G('g2'), G('x')], [P('p1'), P('x')], 7).map((c) => c.catalogId), cards.map((c) => c.catalogId), '같은 seed면 같은 순서')
  assert.ok(cards.every((c) => !c.how.includes('{plugin}')), '일반 카드의 자리표시자는 중립 문구로')
  const scores = Object.fromEntries(cards.map((c) => [c.catalogId, c.source === 'personalized' ? 5 : 2]))
  const file = buildEvalFile({ participant: ' 03 ', platform: 'claude', plan: 'pro', featuresInUse: ['cl_web_search'], cards, scores, report: null, now: new Date('2026-12-01T00:00:00Z') })
  assert.equal(file.format, EVAL_FORMAT); assert.equal(file.participant, '03')
  assert.deepEqual(Object.keys(file.cards[0]).sort(), ['catalogId', 'order', 'score', 'source'], '카드에는 식별자·출처·점수·순서만(이름·설명 없음)')
  assert.deepEqual(parseEvalFile(JSON.stringify(file)), file)
  assert.throws(() => parseEvalFile('{"format":"x"}'), /평가 파일이 아닙니다/)
  assert.throws(() => parseEvalFile(JSON.stringify({ ...file, cards: [{ ...file.cards[0], score: 9 }] })), /손상/)
  const mk = (participant, g, pz) => ({ format: EVAL_FORMAT, participant, exportedAt: '', platform: 'claude', plan: 'free', featuresInUse: [], report: null, cards: [{ catalogId: 'a', source: 'generic', score: g, order: 1 }, { catalogId: 'b', source: 'personalized', score: pz, order: 2 }, { catalogId: 'c', source: 'both', score: 3, order: 3 }] })
  const fu = parseFollowupFile(JSON.stringify({ format: FOLLOWUP_FORMAT, participant: '1', exportedAt: '', evaluatedAt: '', items: [{ catalogId: 'a', source: 'generic', used: false }, { catalogId: 'b', source: 'personalized', used: true }] }))
  const sum = summarizeEval([mk('1', 2, 5), mk('2', 3, 4), mk('3', 4, 4), mk('4', 5, 2)], [fu])
  assert.equal(sum.participants, 4); assert.equal(sum.preferPersonalized, 2); assert.equal(sum.preferGeneric, 1); assert.equal(sum.ties, 1)
  assert.equal(sum.meanGeneric, 3.5); assert.equal(sum.meanPersonalized, 3.75)
  assert.deepEqual(sum.usage.personalized, { used: 1, total: 1 }); assert.deepEqual(sum.usage.generic, { used: 0, total: 1 })
  assert.equal(signTestP(2, 1), 1); assert.equal(signTestP(0, 0), 1); assert.ok(Math.abs(signTestP(9, 1) - 0.021484375) < 1e-12, '10명 중 9명이면 p≈0.021')
  console.log('ab eval ok')
}

// 라벨 데이터 합(labeled-centroids.json): 형식 검사 + 중심점에 더해지면 판정이 그쪽으로 움직이는지
{
  const { TaskClassifier, LABELED, labeledFor, TASK_TYPES, CLASSIFIER_VERSION } = await import('../web/src/classify/classifier.ts')
  assert.equal(CLASSIFIER_VERSION, 'cls-0.3.0')
  assert.equal(LABELED.dim, 384); assert.deepEqual(Object.keys(LABELED.sums).sort(), [...TASK_TYPES, 'other'].sort())
  assert.deepEqual([...LABELED.linear.classes].sort(), [...TASK_TYPES, 'other'].sort(), '선형 분류기는 8유형 + 기타')
  assert.ok(LABELED.linear.W.length === 9 && LABELED.linear.b.length === 9 && LABELED.linear.W.every((r) => r.length === 384 && r.every((x) => Number.isFinite(x))))
  assert.ok(Object.values(LABELED.sums).every((v) => v.length === 384 && v.every((x) => Number.isFinite(x))))
  assert.ok(Object.values(LABELED.counts).reduce((a, b) => a + b, 0) > 300, '라벨 300건 이상')
  assert.equal(labeledFor('Xenova/multilingual-e5-small'), LABELED); assert.equal(labeledFor('static-e5'), undefined, '다른 모델이면 쓰지 않는다')
  // 2차원 장난감: 예시만으로는 v가 a에 가깝지만, b 쪽에 큰 합을 더하면 b의 중심점이 v 쪽으로 옮겨 온다
  const u = (deg) => new Float32Array([Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)])
  const seedVecs = [u(0), u(90)], seedTypes = ['coding', 'writing']
  const v = u(30)
  assert.equal(new TaskClassifier(seedVecs, seedTypes).centroid(v).type, 'coding')
  const moved = new TaskClassifier(seedVecs, seedTypes, undefined, { sums: { writing: [10 * Math.cos(Math.PI / 6), 10 * Math.sin(Math.PI / 6)] } })
  assert.equal(moved.centroid(v).type, 'writing', '라벨 합이 더해진 유형의 중심점이 이동')
  assert.equal(moved.knn(v).type, 'coding', 'k-NN은 예시 발화만 쓴다')
  assert.equal(new TaskClassifier(seedVecs, seedTypes, undefined, { sums: { writing: [1, 2, 3] } }).centroid(v).type, 'coding', '차원이 다르면 무시')
  // 기타: 예시 발화가 없어도 라벨 합이 있으면 중심점이 생긴다
  const withOther = new TaskClassifier(seedVecs, seedTypes, undefined, { sums: { other: [-1, 0] } })
  assert.equal(withOther.centroid(u(170)).type, 'other'); assert.equal(withOther.centroid(u(10)).type, 'coding')
  // D(선형): 학습(linear.mjs) → 예측(classifier.ts)이 이어지는지. 세 방향의 점 묶음을 배우면 그 방향의 새 점을 맞힌다
  const { trainLinear, predictLinear } = await import('./classify/linear.mjs')
  const X = [0, 10, 20, 90, 100, 110, 180, 190, 200].map(u), y = ['coding', 'coding', 'coding', 'writing', 'writing', 'writing', 'other', 'other', 'other']
  const lin = trainLinear(X, y, { l2: 1e-3 })
  assert.deepEqual([5, 95, 185].map((d) => predictLinear(lin, u(d))), ['coding', 'writing', 'other'])
  const d = new TaskClassifier(seedVecs, seedTypes, undefined, { sums: {}, linear: lin })
  assert.deepEqual([5, 95, 185].map((deg) => d.linear(u(deg)).type), ['coding', 'writing', 'other'], '제품 예측이 학습 쪽 예측과 같다')
  assert.ok(d.linear(u(5)).score > 0.5 && d.linear(u(5)).score <= 1, '점수는 확률')
  assert.equal(new TaskClassifier(seedVecs, seedTypes).linear(v).type, 'coding', '가중치가 없으면 중심점으로 대신')
  assert.equal(new TaskClassifier(seedVecs, seedTypes, undefined, { sums: {}, linear: { classes: ['writing'], W: [[1, 2, 3]], b: [9] } }).linear(v).type, 'coding', '차원이 다르면 무시')
  console.log('labeled centroids ok')
}

