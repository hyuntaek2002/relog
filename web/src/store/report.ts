import type { UsageSnapshot } from '../recommend/snapshot'
import type { AnalysisVersion, PeriodSnapshot } from './ledger'

// 결과 파일: 사용자가 내려받아 두었다가 다음 분석과 비교하는 JSON. 숫자 요약(추천 입력값)과 주별 집계뿐이고 대화 내용은 없다.
export const REPORT_FORMAT = 'relog-report-1'

export interface Report {
  format: typeof REPORT_FORMAT
  exportedAt: string // ISO
  version: AnalysisVersion
  snapshot: Omit<UsageSnapshot, 'hourHistogram'>
  weeks: PeriodSnapshot[]
}

export function buildReport(snapshot: UsageSnapshot, weeks: PeriodSnapshot[], version: AnalysisVersion, now = new Date()): Report {
  const { hourHistogram: _h, ...rest } = snapshot
  return { format: REPORT_FORMAT, exportedAt: now.toISOString(), version, snapshot: rest, weeks }
}

export const reportFileName = (now = new Date()) => `relog-결과-${now.toISOString().slice(0, 10)}.json`

// 올린 파일 검사. 우리 형식이 아니거나 주별 집계가 비어 있으면 거부.
export function parseReport(text: string): Report {
  let o: unknown
  try { o = JSON.parse(text) } catch { throw new Error('JSON 파일이 아닙니다') }
  const r = o as Partial<Report>
  if (!r || r.format !== REPORT_FORMAT) throw new Error('relog에서 내려받은 결과 파일이 아닙니다')
  if (!Array.isArray(r.weeks) || r.weeks.length === 0 || !r.weeks.every((w) => typeof w.periodStart === 'number' && w.taskCounts && w.restatement)) throw new Error('주별 집계가 없거나 손상된 파일입니다')
  if (!r.version || !r.snapshot) throw new Error('버전 또는 요약이 없는 파일입니다')
  return r as Report
}
