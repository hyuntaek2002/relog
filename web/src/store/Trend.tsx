import type { PeriodSnapshot } from './ledger'

export type StorageMode = 'none' | 'local'
export const STORAGE_MODE_KEY = 'relog-storage-mode'
export const loadStorageMode = (): StorageMode => { try { return localStorage.getItem(STORAGE_MODE_KEY) === 'local' ? 'local' : 'none' } catch { return 'none' } }

const fmt = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

// 보관 모드 선택 + 주별 추이 표. 저장되는 건 집계용 대장 항목뿐이고 원문·임베딩은 저장하지 않는다.
export default function Trend({ weeks, mode, storedCount, onMode, onClear }: { weeks: PeriodSnapshot[]; mode: StorageMode; storedCount: number; onMode: (m: StorageMode) => void; onClear: () => void }) {
  return (
    <div>
      <div className="checklist">
        <div className="row">
          <span>보관</span>
          <label><input type="radio" name="storage" checked={mode === 'none'} onChange={() => onMode('none')} /> 일회성 분석 (이 화면을 닫으면 사라짐)</label>
          <label><input type="radio" name="storage" checked={mode === 'local'} onChange={() => onMode('local')} /> 이 브라우저에 보관</label>
        </div>
        <p className="detail">
          보관 모드에선 발화별 집계 항목(시각·유형·반복 등급·토큰 추정치)만 브라우저 안 IndexedDB에 저장합니다. 대화 내용과 임베딩은 저장하지 않습니다. 같은 기간을 다시 올리면 덮어쓰고 새 기간만 추가됩니다.
          {mode === 'local' && storedCount > 0 && <> 저장된 발화 {storedCount}개. <button onClick={onClear}>로컬 데이터 삭제</button></>}
        </p>
      </div>
      {weeks.length > 0 && (
        <table>
          <thead>
            <tr><th>주 (월요일 시작)</th><th>내 발화</th><th>비교 가능</th><th>반복 의심 (높·중·낮)</th><th>반복 비율</th><th>재입력 토큰</th></tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.periodStart}>
                <td>{fmt(w.periodStart)}</td>
                <td>{w.userTurnCount}</td>
                <td>{w.judgeable}</td>
                <td>{w.restatement.high}·{w.restatement.medium}·{w.restatement.low}</td>
                <td>{w.judgeable ? `${w.restatement.ratio.toFixed(1)}%` : '-'}</td>
                <td>{w.restatement.tokenEstimate.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {weeks.length === 0 && <p className="detail">아직 기간별 데이터가 없습니다.</p>}
    </div>
  )
}
