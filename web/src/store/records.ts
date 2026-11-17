import { compareSides, type PeriodSnapshot, type TaskCompare } from './ledger.ts'

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

export type RepeatNote = { since: number; delta: number | null }
/** 지난 기록에서도 추천한 항목 → 그 뒤 다시 말한 지시 비율이 어떻게 됐는지(전체 기준). 원인은 판정하지 않는다. */
export function repeatNotes(prev: AnalysisRecord | null, cmp: TaskCompare | null, ids: string[]): Record<string, RepeatNote> {
  if (!prev) return {}
  const was = new Set([...prev.rx, ...prev.plugins])
  return Object.fromEntries(ids.filter((id) => was.has(id)).map((id) => [id, { since: prev.savedAt, delta: cmp?.total.delta ?? null }]))
}
