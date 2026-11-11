import type { Candidate, DetectSummary, Grade } from './detector.ts'

// 사용자의 "반복 아님" 보정(계획서 위험 대응: 탐지 오탐 → 사용자 보정 반영).
// 사용자가 반복이 아니라고 고친 메시지는 등급을 떼고 제외 사유 user_dismissed로 바꾼다. 건수·비율·분량·주별 집계가 모두 이 결과를 쓴다.
// 저장은 메시지 id뿐(원문 없음), 이 브라우저의 localStorage.
export const DISMISSED_KEY = 'relog-not-repeat-v1'
export const loadDismissed = (): string[] => { try { const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] } }
export const saveDismissed = (ids: string[]) => { try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids)) } catch { /* 무시 */ } }

export function applyDismissed(pairs: Candidate[], summary: DetectSummary, dismissed: Iterable<string>): { pairs: Candidate[]; candidates: Candidate[]; summary: DetectSummary; dismissedCount: number } {
  const ids = new Set(dismissed)
  let dismissedCount = 0
  const next = pairs.map((p) => {
    if (!p.grade || !ids.has(p.messageId)) return p
    dismissedCount++
    return { ...p, grade: null, exclusion: 'user_dismissed' as const }
  })
  if (dismissedCount === 0) return { pairs, candidates: pairs.filter((p) => p.grade), summary, dismissedCount }
  const byGrade: Record<Grade, number> = { low: 0, medium: 0, high: 0 }
  const excluded = { ...summary.excluded, user_dismissed: 0 }
  let tokenEstimate = 0, flagged = 0
  for (const p of next) {
    if (p.grade) { byGrade[p.grade]++; tokenEstimate += p.tokenEstimate; flagged++ }
    if (p.exclusion === 'user_dismissed') excluded.user_dismissed++
  }
  return {
    pairs: next,
    candidates: next.filter((p) => p.grade),
    summary: { ...summary, byGrade, tokenEstimate, excluded, ratio: summary.judgeable ? (100 * flagged) / summary.judgeable : 0 },
    dismissedCount,
  }
}
