import { dot } from '../classify/classifier.ts'

export const DETECTOR_VERSION = 'det-0.1.0'

// 같은 대화의 앞선 사용자 발화와 비교해 "이미 말한 지시·정보를 다시 말한 것으로 의심되는" 발화를 찾는다.
// 모델이 이행했는지는 판정하지 않는다(P1 별도 실험).

export interface DetectInput {
  conversationId: string
  messageId: string
  idx: number
  createdAt: number | null
  text: string
  tokenEstimate: number
}

export type Grade = 'low' | 'medium' | 'high'

export interface Candidate {
  conversationId: string
  messageId: string // 반복 의심 발화
  priorMessageId: string // 가장 유사한 앞선 발화
  similarity: number
  repeatMarker: boolean
  newRequestMarker: boolean
  gapMinutes: number | null
  lengthRatio: number // 현재/앞선 길이
  score: number
  grade: Grade | null // null = 임계값 미만(의심 아님). 임계값 조정용으로 모든 쌍을 돌려준다
  tokenEstimate: number // 재입력 토큰 추정치(현재 발화 기준)
}

// 반복 표지: 이미 말했음을 드러내는 표현
export const REPEAT_RE = /아까\s*말|다시\s*말|전에\s*(요청|말|부탁)|왜\s*(빠졌|빠뜨|빼|안\s*(했|됐|들어))|또\s*틀|여전히|계속\s*(틀|안\s*됨|안\s*돼)|또\s*(그러|똑같)|같은\s*(실수|문제)|말했(잖|는데|었)|했잖|분명히|몇\s*번|다시\s*한\s*번|again|as i said|i already|still (wrong|not)|same (mistake|issue)/i
// 새 요구 표지: 앞 발화와 다른 추가·대체 요구
export const NEW_RE = /^(추가로|그리고|이번엔|이번에는|다음으로|이제|또\s*하나|하나\s*더|대신|그\s*다음|그럼\s*이제|플러스|additionally|next,|now,|also,|instead)/i

export interface Weights { sim: number; repeat: number; context: number; newReq: number }
export interface Thresholds { low: number; medium: number; high: number }

// ponytail: E5-small 기준 잠정값. 실제 파일(478쌍)에서 최대 유사도가 p50 0.894, p90 0.922, p95 0.933, p98 0.945로
// 몰려 있어 표지 가중치도 작게 둔다. 합성 개발셋에서 0.90~0.98 구간을 훑어 모델별로 다시 정한다.
export const DEFAULT_WEIGHTS: Weights = { sim: 1.0, repeat: 0.03, context: 0.01, newReq: 0.03 }
export const DEFAULT_THRESHOLDS: Thresholds = { low: 0.93, medium: 0.95, high: 0.98 }

export function grade(score: number, t: Thresholds): Grade | null {
  if (score >= t.high) return 'high'
  if (score >= t.medium) return 'medium'
  if (score >= t.low) return 'low'
  return null
}

// vec(i)는 입력 i의 L2 정규화 임베딩. 입력은 대화별로 idx 오름차순이어야 한다.
export function detect(
  inputs: DetectInput[],
  vec: (i: number) => Float32Array,
  w: Weights = DEFAULT_WEIGHTS,
  t: Thresholds = DEFAULT_THRESHOLDS,
): Candidate[] {
  const out: Candidate[] = []
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
      for (let b = 0; b < a; b++) {
        const s = dot(vj, vec(idxs[b]))
        if (s > bestSim) { bestSim = s; best = idxs[b] }
      }
      const prior = inputs[best]
      const repeatMarker = REPEAT_RE.test(cur.text)
      const newRequestMarker = NEW_RE.test(cur.text)
      const gapMinutes = cur.createdAt != null && prior.createdAt != null ? (cur.createdAt - prior.createdAt) / 60000 : null
      const lengthRatio = cur.text.length / Math.max(1, prior.text.length)
      // 문맥 특징: 사이에 모델 응답이 있다는 전제(활성 경로는 사용자/모델 교대). 짧은 간격·비슷한 길이에 소폭 가점.
      const context = (gapMinutes != null && gapMinutes < 30 ? 0.5 : 0) + (lengthRatio > 0.5 && lengthRatio < 2 ? 0.5 : 0)
      const score = w.sim * bestSim + w.repeat * (repeatMarker ? 1 : 0) + w.context * context - w.newReq * (newRequestMarker ? 1 : 0)
      out.push({ conversationId: cur.conversationId, messageId: cur.messageId, priorMessageId: prior.messageId, similarity: bestSim, repeatMarker, newRequestMarker, gapMinutes, lengthRatio, score, grade: grade(score, t), tokenEstimate: cur.tokenEstimate })
    }
  }
  return out
}

export interface DetectSummary { byGrade: Record<Grade, number>; tokenEstimate: number; judgeable: number; ratio: number }

// R = 반복 의심 발화 수 / 판단 가능 발화 수 × 100
export function summarize(cands: Candidate[], inputs: DetectInput[]): DetectSummary {
  const perConv = new Map<string, number>()
  for (const u of inputs) perConv.set(u.conversationId, (perConv.get(u.conversationId) ?? 0) + 1)
  const judgeable = [...perConv.values()].filter((n) => n >= 2).reduce((a, b) => a + b, 0)
  const byGrade: Record<Grade, number> = { low: 0, medium: 0, high: 0 }
  let tokenEstimate = 0
  let flagged = 0
  for (const c of cands) if (c.grade) { byGrade[c.grade]++; tokenEstimate += c.tokenEstimate; flagged++ }
  return { byGrade, tokenEstimate, judgeable, ratio: judgeable ? (100 * flagged) / judgeable : 0 }
}
