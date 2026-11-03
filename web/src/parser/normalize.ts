import type { Conversation } from './types.ts'

export const NORMALIZER_VERSION = 'norm-0.1.0'

// 임베딩 입력 상한(문자). E5-small 최대 512 토큰 근처. 긴 발화는 앞부분만 쓴다.
export const HEAD_CHARS = 1000

export type UtteranceStatus = 'ok' | 'skipped' | 'context_required'

export interface Utterance {
  conversationId: string
  messageId: string
  idx: number // 대화 안 turn idx
  createdAt: number | null
  text: string // 정규화된 텍스트(코드 블록은 자리표시자)
  status: UtteranceStatus
  hasCode: boolean
  codeLangs: string[]
  truncated: boolean
  hasAttachment: boolean
  tokenEstimate: number
  prevAssistantIdx: number // 이 발화 직전 모델 응답의 turn idx. 없으면 -1
}

// 정보량 없는 발화. 구두점·공백 제거 후 완전 일치만 제외한다(글자수 컷 없음).
const NOISE = new Set(['응', '어', '넵', '네', '예', '웅', '옹', '계속', '계속해', '계속해줘', '고마워', '감사', '감사합니다', '고맙습니다', 'ㅇㅋ', 'ㅇㅇ', 'ㄱㄱ', 'ㄳ', 'ok', 'okay', 'yes', 'y', 'go', 'continue', 'thanks', 'thank you', 'good', '좋아', '좋아요', '알겠어', '알겠습니다', '확인', '됐어', '됐다', '오케이', '진행', '진행해', '진행해줘', '해줘', '그래', '그래요', '맞아', '아니', '아니요', '음', '흠'])

// 짧고 문맥 의존적인 발화를 가리키는 지시·대용 표현
const DEICTIC = /이거|그거|저거|이건|그건|저건|이걸|그걸|이것|그것|여기|거기|위에|아래|앞에|뒤에|그렇게|이렇게|그럼|그래서|다시|또|마저|나머지|\bthis\b|\bthat\b|\bit\b|\bthose\b|\bthese\b|\bagain\b|\bsame\b|\brest\b/i
const SHORT_CHARS = 15

const CODE_BLOCK = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g

export function normalizeText(raw: string): Pick<Utterance, 'text' | 'hasCode' | 'codeLangs' | 'truncated'> {
  const codeLangs: string[] = []
  let text = raw.replace(CODE_BLOCK, (_, lang: string) => {
    codeLangs.push(lang || 'unknown')
    return `[CODE_BLOCK ${lang || 'unknown'}]`
  })
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  const truncated = text.length > HEAD_CHARS
  if (truncated) text = text.slice(0, HEAD_CHARS)
  return { text, hasCode: codeLangs.length > 0, codeLangs, truncated }
}

export function classifyStatus(text: string, hasCode: boolean): UtteranceStatus {
  const bare = text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
  if (!bare) return 'skipped'
  if (NOISE.has(bare)) return 'skipped'
  if (!hasCode && text.length <= SHORT_CHARS && DEICTIC.test(text)) return 'context_required'
  return 'ok'
}

// 사용자 발화만 정규화한다. 모델 응답은 반복 탐지의 문맥 특징(응답 존재 여부)으로만 쓴다.
export function normalizeConversations(convs: Conversation[]): Utterance[] {
  const out: Utterance[] = []
  for (const c of convs) {
    let prevAssistantIdx = -1
    for (const t of c.turns) {
      if (t.role !== 'user') { prevAssistantIdx = t.idx; continue }
      const n = normalizeText(t.text)
      out.push({ conversationId: c.id, messageId: t.messageId, idx: t.idx, createdAt: t.createdAt, ...n, status: classifyStatus(n.text, n.hasCode), hasAttachment: t.hasAttachment, tokenEstimate: t.tokenEstimate, prevAssistantIdx })
    }
  }
  return out
}

export interface NormalizeStats { total: number; ok: number; skipped: number; context_required: number; hasCode: number; truncated: number }

export function normalizeStats(us: Utterance[]): NormalizeStats {
  const s: NormalizeStats = { total: us.length, ok: 0, skipped: 0, context_required: 0, hasCode: 0, truncated: 0 }
  for (const u of us) { s[u.status]++; if (u.hasCode) s.hasCode++; if (u.truncated) s.truncated++ }
  return s
}
