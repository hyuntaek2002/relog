import { compareSides, type PeriodSnapshot, type TaskCompare } from './ledger.ts'
import { foldTask } from '../classify/classifier.ts'

// 분석 기록: 분석할 때마다 그 회차의 요약 숫자와 추천한 항목 이름만 남긴다(전후 비교용). 대화 내용·메시지 id·해시는 없다.
// 이 브라우저(localStorage)에 남기고, 서버 동기화에 로그인했으면 같은 내용을 서버에도 올린다.
export interface AnalysisRecord {
  savedAt: number
  platform: 'chatgpt' | 'claude'
  firstAt: number // 그 내보내기의 가장 이른·늦은 내 메시지 시각
  lastAt: number
  versionKey: string
  judgeable: number // 비교한 내 메시지
  high: number // 다시 말한 지시(확실함)
  tokenEstimate: number
  rx: string[] // 추천한 습관·기능 catalogId
  plugins: string[] // 추천한 플러그인 이름
  applied?: string[] // 내가 '적용함'으로 표시한 항목 키(catalogId·플러그인 이름·prompt:<대화 종류>)
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

// 적용함 표시: 이 브라우저에 항목 키 목록으로 둔다. 분석 기록에도 같이 넣어 다음 분석 때 '적용한 뒤'를 본다.
export const APPLIED_KEY = 'relog-applied-v1'
export const loadApplied = (): string[] => { try { return JSON.parse(localStorage.getItem(APPLIED_KEY) ?? '[]') } catch { return [] } }
export const saveApplied = (a: string[]) => { try { localStorage.setItem(APPLIED_KEY, JSON.stringify(a)) } catch { /* 무시 */ } }
export const promptKey = (task: string) => `prompt:${task}`

// 기록의 종류 키는 추천 쪽 이름(counseling), 비교 표는 분류기 이름(chat)이라 맞춰 준다. 예전 8가지 키(workdoc·search·work_doc)는 합친 종류로 읽는다
const SNAP_TO_TASK: Record<string, string> = { counseling: 'chat', workdoc: 'writing', search: 'learning' }
export const ledgerTask = (t: string) => SNAP_TO_TASK[t] ?? foldTask(t)

/** 항목이 겨냥한 대화 종류의 전후 비율 변화(종류가 없거나 그 종류 표본이 부족하면 전체). task는 분류기 이름으로 돌려준다. */
export function effectOf(cmp: TaskCompare | null, task?: string): { task: string; delta: number | null } {
  const row = task ? cmp?.rows.find((r) => r.task === ledgerTask(task)) : undefined
  return row && row.delta != null ? { task: row.task, delta: row.delta } : { task: 'all', delta: cmp?.total.delta ?? null }
}

export type RepeatNote = { since: number; delta: number | null; task: string; applied: boolean }
/** 지난 기록에서도 추천한 항목 → 그 뒤 그 항목이 겨냥한 대화 종류의 다시 말한 지시 비율이 어떻게 됐는지. 원인은 판정하지 않는다. */
export function repeatNotes(prev: AnalysisRecord | null, cmp: TaskCompare | null, ids: string[]): Record<string, RepeatNote> {
  if (!prev) return {}
  const was = new Set([...prev.rx, ...prev.plugins, ...(prev.applied ?? [])])
  const applied = new Set(prev.applied ?? [])
  return Object.fromEntries(ids.filter((id) => was.has(id)).map((id) => [id, { since: prev.savedAt, ...effectOf(cmp, prev.tasks?.[id]), applied: applied.has(id) }]))
}

// 탐지 결과에 영향을 주는 버전만 비교한다(분류기 버전은 종류 이름만 바꾸고 다시 말한 지시 수는 바꾸지 않는다)
const measureKey = (vk: string) => vk.split('|').filter((_, i) => i !== 3).join('|')
export type SinceLast = { judgeable: number; high: number; ratio: number; delta: number | null } | 'first' | 'version' | 'none'
/**
 * 같은 서비스의 직전 기록 뒤 성과: 내보내기는 처음부터 다 들어 있으므로 두 기록의 차이를 그 사이 새 메시지로 본다(추정).
 * delta = 그 사이 비율 − 직전 기록의 비율(%p). 측정 방식이 다르면 'version', 새 메시지가 없거나 숫자가 줄었으면 'none'.
 * ponytail: 차이로 잰다. 예전 대화를 지웠거나 탐지가 예전 메시지를 달리 판정하면 어긋날 수 있음, 정확히 하려면 지금처럼 새 내보내기를 올려 '변화' 탭에서 볼 것.
 */
export function sinceLast(prev: AnalysisRecord | undefined, cur: AnalysisRecord): SinceLast {
  if (!prev) return 'first'
  if (measureKey(prev.versionKey) !== measureKey(cur.versionKey)) return 'version'
  const judgeable = cur.judgeable - prev.judgeable, high = cur.high - prev.high
  if (judgeable <= 0 || high < 0) return 'none'
  const ratio = (100 * high) / judgeable
  return { judgeable, high, ratio, delta: prev.judgeable ? ratio - (100 * prev.high) / prev.judgeable : null }
}
