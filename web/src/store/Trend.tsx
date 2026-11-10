import { useState } from 'react'
import { TASK_LABELS } from '../classify/classifier'
import { compareTasks, type PeriodSnapshot } from './ledger'

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
        <span>보관</span>
        <label><input type="radio" name="storage" checked={mode === 'none'} onChange={() => onMode('none')} /> 이번만 보기 (창을 닫으면 사라짐)</label>
        <label><input type="radio" name="storage" checked={mode === 'local'} onChange={() => onMode('local')} /> 이 브라우저에 남기기</label>
      </div>
      <p className="detail">
        남기면 메시지별 집계(시각·대화 종류·다시 말한 지시 여부·분량)만 이 브라우저 안에 저장됩니다. 대화 내용은 저장하지 않습니다. 같은 기간을 다시 올리면 덮어쓰고 새 기간만 추가됩니다.
        {mode === 'local' && storedCount > 0 && <> 저장된 메시지 {storedCount}개. <button onClick={onClear}>이 브라우저의 데이터 삭제</button></>}
      </p>
    </div>
  )
}

/** 변화: 대화 종류별 이전→최근 비교(3열) + 주별(접힘). 집계 숫자뿐이고 변화의 원인은 판정하지 않는다. */
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
            <br />숫자는 "그 종류의 내 메시지 중 다시 말한 지시의 비율"입니다. 메시지 5개 미만이면 비우고, 변한 이유는 판정하지 않습니다.
          </p>
          <table>
            <thead><tr><th>대화 종류</th><th>이전 → 최근</th><th>변화</th></tr></thead>
            <tbody>
              {[cmp.total, ...cmp.rows].map((r) => (
                <tr key={r.task} className={r.task === 'all' ? 'total' : ''} title={`이전: 메시지 ${r.before.ok}개 중 ${r.before.flagged}개 · 최근: 메시지 ${r.after.ok}개 중 ${r.after.flagged}개`}>
                  <td>{taskName(r.task)}</td>
                  <td>{pct(r.before.ratio)} → {pct(r.after.ratio)}</td>
                  <td className={r.delta == null ? '' : r.delta < 0 ? 'down' : r.delta > 0 ? 'up' : ''}>{r.delta == null ? '-' : r.delta === 0 ? '그대로' : `${r.delta > 0 ? '늘어남 +' : '줄어듦 '}${r.delta.toFixed(1)}%p`}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
