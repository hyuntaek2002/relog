import { compareSides, type Habits, type PeriodSnapshot, type TaskCompare } from './ledger.ts'
import { foldTask } from '../classify/classifier.ts'

// 분석 기록: 분석할 때마다 그 회차의 요약 숫자와 추천한 항목 이름만 남긴다(전후 비교용). 대화 내용·메시지 id·해시는 없다.
// 이 브라우저(localStorage)에 남기고, 서버 동기화에 로그인했으면 같은 내용을 서버에도 올린다.
export interface AnalysisRecord {
  savedAt: number
  platform: 'chatgpt' | 'claude'
  firstAt: number // 그 내보내기의 가장 이른·늦은 내 메시지 시각
  lastAt: number
  versionKey: string
  conversations?: number // 내 메시지가 있는 대화 수(2026-11-24부터. 예전 기록에는 없음)
  userTurns?: number // 내 메시지 수
  longConversations?: number // 내 메시지 10개 이상인 대화 수
  judgeable?: number // 예전 기록(다시 말한 지시를 셀 때)의 숫자. 지금은 쓰지 않는다
  high?: number
  tokenEstimate?: number
  rx: string[] // 추천한 습관·기능 catalogId
  plugins: string[] // 추천한 플러그인 이름
  applied?: string[] // 내가 '쓰고 있음'으로 표시한 항목 키(catalogId·플러그인 이름·prompt:<대화 종류>)
  tasks?: Record<string, string> // 항목 키 → 그 항목이 겨냥한 대화 종류(없으면 전체로 본다)
}

export const RECORDS_KEY = 'relog-records-v1'
const MAX_RECORDS = 50

export const loadRecords = (): AnalysisRecord[] => { try { return JSON.parse(localStorage.getItem(RECORDS_KEY) ?? '[]') } catch { return [] } }
const saveRecords = (rs: AnalysisRecord[]) => { try { localStorage.setItem(RECORDS_KEY, JSON.stringify(rs)) } catch { /* 무시 */ } }
export const clearRecords = () => { try { localStorage.removeItem(RECORDS_KEY) } catch { /* 무시 */ } }

// 같은 내보내기(플랫폼·마지막 메시지 시각이 같음)를 다시 분석하면 새로 쌓지 않고 덮어쓴다
const sameExport = (a: AnalysisRecord, b: AnalysisRecord) => a.platform === b.platform && a.lastAt === b.lastAt

/** 기록 목록에 합친다(같은 내보내기는 나중 것으로). 마지막 메시지 시각 순, 최대 50개. */
export function mergeRecords(existing: AnalysisRecord[], incoming: AnalysisRecord[]): AnalysisRecord[] {
  const out = [...existing]
  for (const r of incoming) {
    const i = out.findIndex((e) => sameExport(e, r))
    if (i < 0) out.push(r)
    else if (r.savedAt >= out[i].savedAt) out[i] = r
  }
  return out.sort((a, b) => a.lastAt - b.lastAt).slice(-MAX_RECORDS)
}

export function putRecord(r: AnalysisRecord): AnalysisRecord[] {
  const next = mergeRecords(loadRecords(), [r])
  saveRecords(next)
  return next
}
export function putRecords(rs: AnalysisRecord[]): AnalysisRecord[] {
  const next = mergeRecords(loadRecords(), rs)
  saveRecords(next)
  return next
}

/** 이번 분석보다 앞선 기록(같은 플랫폼), 최근 것부터 */
export const previousRecords = (all: AnalysisRecord[], cur: Pick<AnalysisRecord, 'platform' | 'lastAt'>) =>
  all.filter((r) => r.platform === cur.platform && r.lastAt < cur.lastAt).sort((a, b) => b.lastAt - a.lastAt)

/**
 * 전후 비교: 내보내기는 처음부터 지금까지 다 들어 있으므로, 지금 분석의 주별 숫자를 지난 기록의 마지막 메시지 시각으로 나눈다.
 * 같은 분석 방식으로 양쪽을 재므로 버전이 달라도 공정하다. 마지막 메시지가 든 주는 이전 쪽에 넣는다.
 * ponytail: 주 단위로 자른다. 그 주 안의 이후 메시지가 이전 쪽에 섞일 수 있음, 필요하면 메시지 단위 대장으로 자를 것.
 */
export function compareSince(weeks: PeriodSnapshot[], prev: Pick<AnalysisRecord, 'lastAt'>): TaskCompare {
  const sorted = [...weeks].sort((a, b) => a.periodStart - b.periodStart)
  return compareSides(sorted.filter((w) => w.periodStart <= prev.lastAt), sorted.filter((w) => w.periodStart > prev.lastAt))
}

export const promptKey = (task: string) => `prompt:${task}`

// 기록의 종류 키는 추천 쪽 이름(counseling), 비교 표는 분류기 이름(chat)이라 맞춰 준다. 예전 8가지 키(workdoc·search·work_doc)는 합친 종류로 읽는다
const SNAP_TO_TASK: Record<string, string> = { counseling: 'chat', workdoc: 'writing', search: 'learning' }
export const ledgerTask = (t: string) => SNAP_TO_TASK[t] ?? foldTask(t)

export type RepeatNote = { since: number; applied: boolean; habits: { before: Habits; after: Habits } | null }
/** 지난 기록에서도 추천한 항목 → 그 뒤 대화 습관(대화당 메시지, 긴 대화 비율)이 어떻게 됐는지. 원인은 판정하지 않는다. */
export function repeatNotes(prev: AnalysisRecord | null, cmp: TaskCompare | null, ids: string[]): Record<string, RepeatNote> {
  if (!prev) return {}
  const was = new Set([...prev.rx, ...prev.plugins, ...(prev.applied ?? [])])
  const applied = new Set(prev.applied ?? [])
  const habits = cmp && cmp.habits.after.ok > 0 ? cmp.habits : null
  return Object.fromEntries(ids.filter((id) => was.has(id)).map((id) => [id, { since: prev.savedAt, applied: applied.has(id), habits }]))
}

// 대화 습관 숫자는 파서·정규화 버전에만 달려 있다(모델·분류기·탐지 버전과 무관)
const measureKey = (vk: string) => vk.split('|').slice(0, 2).join('|')
export type Habit = { conversations: number; avgTurns: number; longShare: number }
export type SinceLast = { now: Habit; prev: Habit; applied: number } | 'first' | 'legacy' | 'version' | 'none'
const habitOf = (conversations: number, turns: number, long: number): Habit => ({ conversations, avgTurns: turns / conversations, longShare: (100 * long) / conversations })
/**
 * 같은 서비스의 직전 기록 뒤 성과: 내보내기는 처음부터 다 들어 있으므로 두 기록의 차이를 그 사이 새 대화로 본다(추정).
 * now = 그 사이 새 대화의 습관, prev = 직전 기록 전체의 습관, applied = 직전 기록에서 추천했고 지금 '쓰고 있음'인 항목 수.
 * ponytail: 차이로 잰다. 예전 대화를 지웠거나 직전 기록 뒤 이어서 쓴 대화는 어긋날 수 있음, 정확히 하려면 '변화' 탭에서 볼 것.
 */
export function sinceLast(prev: AnalysisRecord | undefined, cur: AnalysisRecord): SinceLast {
  if (!prev) return 'first'
  if (prev.conversations == null || cur.conversations == null || !prev.conversations) return 'legacy'
  if (measureKey(prev.versionKey) !== measureKey(cur.versionKey)) return 'version'
  const dc = cur.conversations - prev.conversations, dt = (cur.userTurns ?? 0) - (prev.userTurns ?? 0), dl = (cur.longConversations ?? 0) - (prev.longConversations ?? 0)
  if (dc <= 0 || dt < 0 || dl < 0) return 'none'
  const was = new Set([...prev.rx, ...prev.plugins])
  return { now: habitOf(dc, dt, dl), prev: habitOf(prev.conversations, prev.userTurns ?? 0, prev.longConversations ?? 0), applied: (cur.applied ?? []).filter((k) => was.has(k)).length }
}
