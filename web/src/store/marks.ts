// 쓰고 있음 / 사용하지 않음 표시(2026-11-24): 추천 카드·플러그인마다 사용자가 직접 누른다.
// 키는 catalogId·플러그인 이름·prompt:<대화 종류>. 이 브라우저에 두고, 로그인했으면 서버(피드백 기록)에도 남겨 다른 기기·캐시 삭제 뒤에도 이어진다.
export type Mark = 'using' | 'not_using'
export type Marks = Record<string, Mark>

export const MARKS_KEY = 'relog-marks-v1'
const OLD_APPLIED_KEY = 'relog-applied-v1' // 예전 '적용함' 표시 → 쓰고 있음
const OLD_FEEDBACK_KEY = 'relog-feedback-v1' // 예전 '이미 씀' 피드백 → 쓰고 있음

const read = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d } catch { return d } }

export function loadMarks(): Marks {
  const saved = read<Marks | null>(MARKS_KEY, null)
  if (saved) return saved
  const out: Marks = {}
  for (const k of read<string[]>(OLD_APPLIED_KEY, [])) out[k] = 'using'
  for (const [k, v] of Object.entries(read<Record<string, string>>(OLD_FEEDBACK_KEY, {}))) if (v === 'already_using') out[k] = 'using'
  return out
}
export const saveMarks = (m: Marks) => { try { localStorage.setItem(MARKS_KEY, JSON.stringify(m)) } catch { /* 무시 */ } }

/** 같은 표시를 다시 누르면 지운다 */
export function toggleMark(m: Marks, key: string, v: Mark): Marks {
  const next = { ...m }
  if (next[key] === v) delete next[key]
  else next[key] = v
  return next
}

/** 서버 피드백 기록(시간순) → 항목별 마지막 표시. '이미 씀'(예전 값)은 쓰고 있음으로 읽는다 */
export function marksFromFeedback(rows: { catalogId: string; value: string }[]): Marks {
  const out: Marks = {}
  for (const r of rows) {
    if (r.value === 'using' || r.value === 'already_using') out[r.catalogId] = 'using'
    else if (r.value === 'not_using') out[r.catalogId] = 'not_using'
    else if (r.value === 'unmarked') delete out[r.catalogId] // 표시를 지움
  }
  return out
}

/** 서버에 표시 기록이 있는 항목은 서버 값(마지막 표시)으로, 서버에 없는 항목은 이 브라우저 값 그대로 */
export function mergeServerMarks(local: Marks, rows: { catalogId: string; value: string }[]): Marks {
  const touched = new Set(rows.filter((r) => /^(using|not_using|already_using|unmarked)$/.test(r.value)).map((r) => r.catalogId))
  return { ...Object.fromEntries(Object.entries(local).filter(([k]) => !touched.has(k))), ...marksFromFeedback(rows) }
}

export const usingKeys = (m: Marks) => Object.keys(m).filter((k) => m[k] === 'using')
