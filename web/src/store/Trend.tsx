import { useState } from 'react'
import Help from '../ui/Help'
import { TASK_LABELS } from '../classify/classifier'
import type { UsageSnapshot } from '../recommend/snapshot'
import { compareSides, compareTasks, versionKey, type AnalysisVersion, type PeriodSnapshot, type TaskCompare } from './ledger'
import { buildReport, parseReport, reportFileName, type Report } from './report'

export type StorageMode = 'none' | 'local'
export const STORAGE_MODE_KEY = 'relog-storage-mode'
export const loadStorageMode = (): StorageMode => { try { return localStorage.getItem(STORAGE_MODE_KEY) === 'local' ? 'local' : 'none' } catch { return 'none' } }

const fmt = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
const fmtRange = (r: [number, number] | null) => (r ? `${fmt(r[0])} ~ ${fmt(r[1] - 1)}` : '-')
const taskName = (t: string) => (t === 'all' ? '전체' : t === 'other' ? '기타' : (TASK_LABELS as Record<string, string>)[t] ?? t)
const pct = (v: number | null) => (v == null ? '-' : `${v.toFixed(1)}%`)

/** 보관 방식 선택(파일 넣기 전·후 공통) */
export function StorageChoice({ mode, storedCount, onMode, onClear }: { mode: StorageMode; storedCount: number; onMode: (m: StorageMode) => void; onClear: () => void }) {
  return (
    <div className="checklist">
      <div className="row">
        <span>보관<Help text="남기면 메시지별 집계(시각·대화 종류·다시 말한 지시 여부·분량)만 이 브라우저 안에 저장됩니다. 대화 내용은 저장하지 않습니다. 같은 기간을 다시 올리면 덮어쓰고 새 기간만 추가됩니다." /></span>
        <label><input type="radio" name="storage" checked={mode === 'none'} onChange={() => onMode('none')} /> 이번만 보기</label>
        <label><input type="radio" name="storage" checked={mode === 'local'} onChange={() => onMode('local')} /> 이 브라우저에 남기기</label>
      </div>
      {mode === 'local' && storedCount > 0 && <p className="detail">저장된 메시지 {storedCount}개. <button onClick={onClear}>이 브라우저의 데이터 삭제</button></p>}
    </div>
  )
}

/** 대화 종류별 이전→이후 비율 표(3열). 변화 방향만 색으로, 원인은 판정하지 않는다. */
export function CompareTable({ cmp, before, after }: { cmp: TaskCompare; before: string; after: string }) {
  return (
    <table>
      <thead><tr><th>대화 종류</th><th>{before} → {after}</th><th>변화</th></tr></thead>
      <tbody>
        {[cmp.total, ...cmp.rows].map((r) => (
          <tr key={r.task} className={r.task === 'all' ? 'total' : ''} title={`${before}: 메시지 ${r.before.ok}개 중 ${r.before.flagged}개 · ${after}: 메시지 ${r.after.ok}개 중 ${r.after.flagged}개`}>
            <td>{taskName(r.task)}</td>
            <td>{pct(r.before.ratio)} → {pct(r.after.ratio)}</td>
            <td className={r.delta == null ? '' : r.delta < 0 ? 'down' : r.delta > 0 ? 'up' : ''}>{r.delta == null ? '-' : r.delta === 0 ? '그대로' : `${r.delta > 0 ? '늘어남 +' : '줄어듦 '}${r.delta.toFixed(1)}%p`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** 변화: 대화 종류별 이전→최근 비교 + 주별(접힘). 집계 숫자뿐이고 변화의 원인은 판정하지 않는다. */
export default function Trend({ weeks }: { weeks: PeriodSnapshot[] }) {
  const [recent, setRecent] = useState(2)
  const cmp = weeks.length >= 2 ? compareTasks(weeks, Math.min(recent, weeks.length - 1)) : null
  if (weeks.length === 0) return <p className="detail">아직 기간별 데이터가 없습니다.</p>
  return (
    <div>
      {cmp ? (
        <>
          <p className="detail">
            이전 {fmtRange(cmp.beforeRange)} → 최근 {fmtRange(cmp.afterRange)}
            <span> · 최근 <select value={recent} onChange={(e) => setRecent(Number(e.target.value))}>{[1, 2, 4].map((n) => <option key={n} value={n}>{n}주</option>)}</select></span>
            <Help text="숫자는 '그 종류의 내 메시지 중 다시 말한 지시의 비율'입니다. 메시지 5개 미만이면 비우고, 변한 이유는 판정하지 않습니다." />
          </p>
          <CompareTable cmp={cmp} before="이전" after="최근" />
        </>
      ) : (
        <p className="detail">비교하려면 2주 이상의 데이터가 필요합니다.</p>
      )}
      <details>
        <summary>주별로 보기</summary>
        <table>
          <thead><tr><th>주 (월요일 시작)</th><th>내 메시지</th><th>다시 말한 지시</th></tr></thead>
          <tbody>
            {weeks.map((w) => {
              const flagged = w.restatement.high + w.restatement.medium + w.restatement.low
              return (
                <tr key={w.periodStart} title={`확실함 ${w.restatement.high} · 가능성 있음 ${w.restatement.medium} · 약함 ${w.restatement.low} · 다시 친 분량 약 ${w.restatement.tokenEstimate.toLocaleString()}토큰`}>
                  <td>{fmt(w.periodStart)}</td>
                  <td>{w.userTurnCount}</td>
                  <td>{flagged}건{w.judgeable ? ` (${w.restatement.ratio.toFixed(1)}%)` : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </details>
    </div>
  )
}

/** 결과 파일: 이번 분석의 숫자를 JSON으로 내려받고, 예전에 내려받은 파일을 올려 지금과 비교한다. */
export function ReportFile({ snapshot, weeks, version }: { snapshot: UsageSnapshot; weeks: PeriodSnapshot[]; version: AnalysisVersion }) {
  const [old, setOld] = useState<Report | null>(null)
  const [err, setErr] = useState('')

  function download() {
    const blob = new Blob([JSON.stringify(buildReport(snapshot, weeks, version), null, 1)], { type: 'application/json' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: reportFileName() })
    a.click()
    URL.revokeObjectURL(a.href)
  }
  async function load(f: File | undefined) {
    if (!f) return
    try { setOld(parseReport(await f.text())); setErr('') } catch (e) { setOld(null); setErr((e as Error).message) }
  }

  const cmp = old ? compareSides(old.weeks, weeks) : null
  const better = cmp?.rows.filter((r) => r.delta != null && r.delta < 0).map((r) => taskName(r.task)) ?? []
  const worse = cmp?.rows.filter((r) => r.delta != null && r.delta > 0).map((r) => taskName(r.task)) ?? []
  return (
    <div>
      <p className="actions">
        <button onClick={download}>결과 파일로 저장</button>
        <label className="btn">예전 결과 파일과 비교<input type="file" accept=".json,application/json" onChange={(e) => load(e.target.files?.[0])} /></label>
        <Help text="파일에는 이 화면의 숫자(대화 종류별 수, 다시 말한 지시 수, 주별 집계)만 들어가고 대화 내용은 없습니다. 다음에 새 내보내기를 분석한 뒤 이 파일을 올리면 종류별로 줄었는지 늘었는지 보여 줍니다." />
      </p>
      {err && <p className="err">{err}</p>}
      {old && cmp && (
        <>
          <p className="detail">
            예전 파일 {old.exportedAt.slice(0, 10)} 저장({fmtRange(cmp.beforeRange)}) → 지금({fmtRange(cmp.afterRange)}).
            {better.length > 0 && <> 줄어든 종류: <b>{better.join(', ')}</b>.</>}
            {worse.length > 0 && <> 늘어난 종류: <b>{worse.join(', ')}</b>.</>}
            {better.length === 0 && worse.length === 0 && ' 비교할 수 있는 종류에서 변화가 없습니다.'}
            {versionKey(old.version) !== versionKey(version) && ' 분석 방식 버전이 달라 수치가 조금 다를 수 있습니다.'}
          </p>
          <CompareTable cmp={cmp} before="예전" after="지금" />
        </>
      )}
    </div>
  )
}
