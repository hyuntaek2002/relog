import { dot } from '../classify/classifier.ts'

export const DETECTOR_VERSION = 'det-0.4.0'

// 같은 대화의 앞선 사용자 발화와 비교해 "이미 말한 지시·정보를 다시 말한 것으로 의심되는" 발화를 찾는다.
// 모델이 이행했는지는 판정하지 않는다(P1 별도 실험).
//
// 규칙 요약
//  - 유사도 기준은 절대값이 아니라 그 사용자의 "서로 다른 대화 무작위 쌍" 분포(귀무분포)의 상위 1%.
//  - 0.3: 기준선은 묶음(group: 앱/Claude Code)별로 따로 잰다. 한 주제로 오래 가는 코딩 세션은 기본 유사도가 높아 한 기준으로는 Code 쪽이 과다 검출됐다.
//  - 지시형 발화만 반복 지시 후보. 질문형은 "반복 질문"으로 따로 센다. 과업 유형 상담·대화는 제외.
//  - 재전송/수정(접두어 포함·편집 거리 작음, 몇 분 이내), 범용 발화(3개 이상 대화에 같은 문장), 첨부 동반은 제외.
//  - 0.3: 앞선 발화와 글자까지 같은 지시를 재전송 시간 밖에서 다시 내린 것, 그리고 커밋·푸시·배포류 짧은 지시는 정기 명령으로 보고 제외(routine).
//    끝날 때마다 내리는 명령이라 반복이지 다시 말한 것이 아니다. 실측: Code 표시 286건 중 글자까지 같은 것 15건, 한 세션에서 같은 문장 11번.
//  - 등급: 낮음 = 유사도 상위 1% + 지시형 + 제외 통과 / 중간 = 낮음 + 24시간 이내 + 사이에 모델 응답 / 높음 = 중간 + 반복 표지.
//  - 24시간 넘은 쌍은 표지가 없으면 주제 재방문으로 보고 후보에서 뺀다.
//  - 0.4: 실제 ChatGPT 대화의 높음 등급 27건 중 틀린 10건을 보고 고침(docs/measurements.md 2026-11-12).
//    (1) 반복 표지를 좁힘: "같은 문제"(문제 풀이), "다시 말해"(요청), "아까 말했던 거"(미뤄 둔 일)는 반복이 아니었다.
//    (2) 코드가 대부분인 메시지(코드 낱말 3개 이상, 한글이 글자의 20% 미만)는 지시문으로 보지 않는다. 다른 파일의 코드를 연달아 붙여 넣으면 서로 비슷해 높음으로 잡혔다.

export interface DetectInput {
  conversationId: string
  messageId: string
  idx: number
  createdAt: number | null
  text: string
  tokenEstimate: number
  hasAttachment: boolean
  prevAssistantIdx: number // 직전 모델 응답 turn idx, 없으면 -1
  taskType?: string // 과업 분류 결과(chat 제외용)
  group?: string // 기준선 묶음(앱/Claude Code). 없으면 전체 기준 사용
}

export type Grade = 'low' | 'medium' | 'high'
export type UtteranceKind = 'instruction' | 'question' | 'other'
export type Exclusion = 'below_null' | 'not_instruction' | 'chat_task' | 'resend' | 'routine' | 'generic' | 'attachment' | 'stale' | 'user_dismissed' // user_dismissed: 사용자가 "반복 아님"으로 고침(corrections.ts)

export interface Candidate {
  conversationId: string
  messageId: string // 반복 의심 발화
  priorMessageId: string // 가장 유사한 앞선 발화
  similarity: number
  kind: UtteranceKind
  repeatMarker: boolean
  complaintMarker: boolean
  gapMinutes: number | null
  responseBetween: boolean
  grade: Grade | null // null = 후보 아님(exclusion 참고)
  exclusion: Exclusion | null
  tokenEstimate: number // 재입력 토큰 추정치(현재 발화 기준)
}

// 반복 표지: 이미 말했음을 드러내는 표현(높음 등급 조건)
export const REPEAT_RE = /아까\s*말한\s*대로|말했듯|말씀드렸듯|다시\s*말하(지만|는데)|다시\s*말씀드리(지만|면)|전에\s*(요청|말|부탁)|왜\s*(빠졌|빠뜨|빼|안\s*(했|됐|들어))|또\s*(틀|그러|똑같|빠)|여전히|계속\s*(틀|안\s*됨|안\s*돼)|같은\s*실수|(또|계속)\s*같은\s*(문제|오류|에러)|말했(잖|는데|었)|했잖|분명히|몇\s*번|다시\s*한\s*번|again|as i said|i already|still (wrong|not)|same (mistake|issue)/i
// 이해 실패 항의 표지: 모델이 요지를 못 알아들은 데 대한 반응
export const COMPLAINT_RE = /라니까|다니까|자꾸|그게\s*아니|아니\s*(그게|내\s*말은|그런\s*뜻)|이해를?\s*못|못\s*알아|뭔\s*소리|what i meant|that'?s not what/i
// 새 요구 표지는 유형 판정에만 참고(접두사면 지시여도 새 요청일 가능성) — 0.2에서는 점수 미사용

// 지시: 명령형 어미(~줘/주세요/달라/해봐/해라/하자) + 흔한 작업 동사 + 배제·한정 표현(빼고/말고/~만) + 영어 명령문
const INSTRUCTION_RE = /(줘|주세요|달라|해\s*봐|해봐|해라|하세요|하자|해\s*주|부탁|빼고|말고|으로\s*(해|써|바꿔|다시|정리|작성)|로\s*다시|작성|수정|추가|넣어|바꿔|고쳐|만들어|정리|설명해|번역해|구현|적용|반영|삭제|생성|출력|요약|검토|분석해|확인해|비교해|추천해|줄여|늘려|다듬어|\bonly\b|\bplease\b|^(write|make|add|fix|implement|translate|create|update|remove|change|show|give|list|explain|summarize|keep|use)\b)/i
const QUESTION_RE = /\?|할까|맞아|맞지|맞나|어떻게\s*생각|뭐야|뭔가요|인가요|일까|나요\s*$|되나|될까|어때|왜\s|어디|언제|누구|뭘\s|무엇|있어\s*$|있나|없나|\b(what|why|how|when|where|which|is it|does|do you|can you|should)\b/i

// 정기 작업 명령 표지: 끝날 때마다 내리는 커밋·푸시·배포류와 "다음 단계 하자"·"이어서"·"확인해봐" 같은 진행 명령. 짧은 지시(routineMaxChars 이하)에만 적용
export const ROUTINE_RE = /커밋|푸시|푸쉬|배포|머지|빌드|올려\s*줘|다음\s*(단계|거|것)|이어서|계속\s*(하|진행|가)|진행\s*하자|확인해\s*봐|끝나면\s*(말|알려)|\b(commit|push|deploy|merge|build|continue|next step|go on)\b/i

// 코드가 대부분인 메시지: 코드 낱말이 3개 이상이고 한글이 글자(공백 제외)의 20% 미만.
// 코드 뒤에 짧게 붙인 한국어 지시("이건 어디에 넣어?")는 코드로 보고, 코드와 함께 긴 한국어 항의를 쓴 메시지는 그대로 둔다.
const CODE_TOKEN_RE = /[{};]|=>|<\/?[a-zA-Z]|\b(import|function|const|let|def|class|package|return|public|private)\b/g
export function isCodeHeavy(text: string): boolean {
  const chars = text.replace(/\s/g, '').length || 1
  const hangul = (text.match(/[가-힣]/g) ?? []).length
  return (text.match(CODE_TOKEN_RE) ?? []).length >= 3 && hangul / chars < 0.2
}

export function kindOf(text: string): UtteranceKind {
  if (isCodeHeavy(text)) return 'other' // 코드 붙여넣기는 지시문 후보가 아니다(0.4)
  if (INSTRUCTION_RE.test(text)) return 'instruction'
  if (QUESTION_RE.test(text)) return 'question'
  return 'other'
}

// 범용 발화·재전송 비교용 정규화: 공백·구두점·기호 제거, 소문자
export const canon = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()

// 편집 거리(길이 비율). 긴 입력은 앞 300자만 — 재전송 판정엔 충분.
export function editRatio(a: string, b: string): number {
  a = a.slice(0, 300); b = b.slice(0, 300)
  const m = a.length, n = b.length
  if (!m || !n) return m === n ? 0 : 1
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n] / Math.max(m, n)
}

export interface DetectOptions {
  nullThreshold: number // 귀무분포 상위 1% 경계(코사인). 묶음 기준이 없는 발화에 적용
  groupThreshold?: Record<string, number> // 묶음별 기준(코사인). 있으면 그 묶음 발화에 우선 적용
  resendMinutes: number
  resendEditRatio: number
  genericConversations: number // 이 수 이상 대화에 같은 문장이 나오면 범용
  genericMaxChars: number // 정규화 후 이 길이 이하("수정해줘")는 내용이 없어 범용으로 본다
  staleHours: number
  markerFloor: number // 반복 표지가 있는 지시는 유사도가 이 값만 넘어도 후보(경계 미만 구제). Infinity면 비활성
  window: number // 앞선 사용자 발화 중 최근 몇 개와 비교할지. 긴 대화에서 먼 과거와의 우연한 최대값을 막는다
  routineMaxChars: number // 정규화 후 이 길이 이하이고 정기 작업 표지(ROUTINE_RE)가 있으면 정기 명령으로 제외
}
export const DEFAULT_OPTIONS: DetectOptions = { nullThreshold: 1, resendMinutes: 10, resendEditRatio: 0.15, genericConversations: 3, genericMaxChars: 5, staleHours: 24, markerFloor: Infinity, window: 10, routineMaxChars: 30 }

// 귀무분포: 서로 다른 대화에서 뽑은 무작위 쌍의 코사인. 결정적 난수(LCG)로 재현 가능.
export function nullDistribution(inputs: DetectInput[], vec: (i: number) => Float32Array, pairs = 3000, seed = 42): number[] {
  const n = inputs.length
  if (n < 2) return []
  let s = seed >>> 0
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  const out: number[] = []
  for (let k = 0; k < pairs * 4 && out.length < pairs; k++) {
    const i = Math.floor(rnd() * n), j = Math.floor(rnd() * n)
    if (i === j || inputs[i].conversationId === inputs[j].conversationId) continue
    out.push(dot(vec(i), vec(j)))
  }
  return out.sort((a, b) => a - b)
}

// 같은 대화 안 비인접 쌍(사용자 발화 기준 2칸 이상 떨어진 쌍)의 코사인 분포. 주제를 공유하는 발화들의 기본 유사도.
// 합성 개발셋(devset-0.1.0)에서 다른 대화 쌍 p99보다 정밀도가 높았다(P .75 vs .55).
export function withinConversationNull(inputs: DetectInput[], vec: (i: number) => Float32Array, window = DEFAULT_OPTIONS.window, maxPairs = 20000): number[] {
  const byConv = new Map<string, number[]>()
  inputs.forEach((u, i) => byConv.set(u.conversationId, [...(byConv.get(u.conversationId) ?? []), i]))
  const sims: number[] = []
  for (const idxs of byConv.values()) {
    // 후보 탐색과 같은 창(window) 안의 비인접 쌍만. 긴 대화의 먼 과거 쌍이 분포를 끌어내리지 않게.
    for (let a = 0; a < idxs.length && sims.length < maxPairs; a++) for (let b = a + 2; b < idxs.length && b - a <= window; b++) sims.push(dot(vec(idxs[a]), vec(idxs[b])))
  }
  return sims.sort((x, y) => x - y)
}

// 발화에 적용할 기준: 묶음 기준이 있으면 그것, 없으면 전체 기준
export const thresholdFor = (u: Pick<DetectInput, 'group'>, nullThreshold: number, groupThreshold?: Record<string, number>) => (u.group != null ? groupThreshold?.[u.group] : undefined) ?? nullThreshold

export const quantile = (sorted: number[], q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 1)

// 입력은 대화별로 idx 오름차순이어야 한다. 모든 쌍을 돌려주고 grade/exclusion으로 구분한다.
export function detect(inputs: DetectInput[], vec: (i: number) => Float32Array, opt: DetectOptions = DEFAULT_OPTIONS): Candidate[] {
  const out: Candidate[] = []
  // 범용 발화: 같은 정규화 문장이 나오는 대화 수
  const convsByCanon = new Map<string, Set<string>>()
  for (const u of inputs) {
    const c = canon(u.text)
    if (!convsByCanon.has(c)) convsByCanon.set(c, new Set())
    convsByCanon.get(c)!.add(u.conversationId)
  }
  const isGeneric = (text: string) => (convsByCanon.get(canon(text))?.size ?? 0) >= opt.genericConversations

  const byConv = new Map<string, number[]>()
  inputs.forEach((u, i) => byConv.set(u.conversationId, [...(byConv.get(u.conversationId) ?? []), i]))

  for (const idxs of byConv.values()) {
    if (idxs.length < 2) continue // 판단 가능 발화는 사용자 발화 2개 이상인 대화만
    for (let a = 1; a < idxs.length; a++) {
      const j = idxs[a]
      const cur = inputs[j]
      const vj = vec(j)
      let best = -1
      let bestSim = -Infinity
      for (let b = Math.max(0, a - (opt.window || Infinity)); b < a; b++) {
        const s = dot(vj, vec(idxs[b]))
        if (s > bestSim) { bestSim = s; best = idxs[b] }
      }
      const prior = inputs[best]
      const kind = kindOf(cur.text)
      const repeatMarker = REPEAT_RE.test(cur.text)
      const complaintMarker = COMPLAINT_RE.test(cur.text)
      const gapMinutes = cur.createdAt != null && prior.createdAt != null ? (cur.createdAt - prior.createdAt) / 60000 : null
      const responseBetween = cur.prevAssistantIdx > prior.idx
      const base = { conversationId: cur.conversationId, messageId: cur.messageId, priorMessageId: prior.messageId, similarity: bestSim, kind, repeatMarker, complaintMarker, gapMinutes, responseBetween, tokenEstimate: cur.tokenEstimate }

      let exclusion: Exclusion | null = null
      const ca = canon(prior.text), cb = canon(cur.text)
      const nearSame = cb.startsWith(ca) || ca.startsWith(cb) || editRatio(ca, cb) <= opt.resendEditRatio
      const rescued = repeatMarker && kind === 'instruction' && bestSim >= opt.markerFloor
      if (bestSim < thresholdFor(cur, opt.nullThreshold, opt.groupThreshold) && !rescued) exclusion = 'below_null'
      else if (isGeneric(cur.text) || cb.length <= opt.genericMaxChars) exclusion = 'generic'
      else if (nearSame && gapMinutes != null && gapMinutes <= opt.resendMinutes) exclusion = 'resend'
      else if (kind !== 'instruction') exclusion = 'not_instruction'
      else if (ca === cb || (cb.length <= opt.routineMaxChars && ROUTINE_RE.test(cur.text))) exclusion = 'routine' // 글자까지 같은 지시, 또는 커밋·배포 같은 짧은 정기 작업 명령. 다시 말한 지시는 보통 말을 보태거나 바꾼다
      else if (cur.taskType === 'chat') exclusion = 'chat_task'
      else if (cur.hasAttachment) exclusion = 'attachment'
      else if (gapMinutes != null && gapMinutes > opt.staleHours * 60 && !repeatMarker) exclusion = 'stale'

      let grade: Grade | null = null
      if (!exclusion) {
        grade = 'low'
        if (gapMinutes != null && gapMinutes <= opt.staleHours * 60 && responseBetween) grade = 'medium'
        if (grade === 'medium' && repeatMarker) grade = 'high'
      }
      out.push({ ...base, grade, exclusion })
    }
  }
  return out
}

export interface DetectSummary {
  byGrade: Record<Grade, number>
  tokenEstimate: number
  judgeable: number
  ratio: number // R = 반복 의심 지시 / 판단 가능 발화 × 100
  repeatedQuestions: number // 질문형인데 유사도 상위 1% (헤드라인에 넣지 않음)
  misunderstanding: number // 이해 실패 항의 표지가 있는 발화
  excluded: Record<Exclusion, number>
  nullThreshold: number
  groupThreshold: Record<string, number> // 묶음별 기준(앱/Claude Code). 묶음이 없으면 빈 객체
}

export function summarize(pairs: Candidate[], inputs: DetectInput[], nullThreshold: number, groupThreshold: Record<string, number> = {}): DetectSummary {
  const groupOf = new Map(inputs.map((u) => [u.messageId, u.group]))
  const perConv = new Map<string, number>()
  for (const u of inputs) perConv.set(u.conversationId, (perConv.get(u.conversationId) ?? 0) + 1)
  const judgeable = [...perConv.values()].filter((n) => n >= 2).reduce((a, b) => a + b, 0)
  const byGrade: Record<Grade, number> = { low: 0, medium: 0, high: 0 }
  const excluded: Record<Exclusion, number> = { below_null: 0, not_instruction: 0, chat_task: 0, resend: 0, routine: 0, generic: 0, attachment: 0, stale: 0, user_dismissed: 0 }
  let tokenEstimate = 0, flagged = 0, repeatedQuestions = 0, misunderstanding = 0
  for (const c of pairs) {
    if (c.grade) { byGrade[c.grade]++; tokenEstimate += c.tokenEstimate; flagged++ }
    if (c.exclusion) excluded[c.exclusion]++
    if (c.kind === 'question' && c.similarity >= thresholdFor({ group: groupOf.get(c.messageId) }, nullThreshold, groupThreshold) && c.exclusion !== 'resend' && c.exclusion !== 'generic') repeatedQuestions++
    if (c.complaintMarker) misunderstanding++
  }
  return { byGrade, tokenEstimate, judgeable, ratio: judgeable ? (100 * flagged) / judgeable : 0, repeatedQuestions, misunderstanding, excluded, nullThreshold, groupThreshold }
}
