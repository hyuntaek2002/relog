import Help from '../ui/Help'
import { CATALOG } from '../recommend/recommend'
import { isInstalled } from '../recommend/taskPluginRules'
import { CompareTable } from './Trend'
import type { TaskCompare } from './ledger'
import { TASK_LABELS } from '../classify/classifier'
import { effectOf, ledgerTask, type AnalysisRecord, type RepeatNote } from './records'

const day = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
const taskLabel = (t: string) => (TASK_LABELS as Record<string, string>)[t] ?? t
const rxName = (id: string) => id.startsWith('prompt:') ? `${taskLabel(ledgerTask(id.slice(7)))} 시작 문구` : CATALOG.find((c) => c.id === id)?.name ?? id
// 효과 한 줄: "그 뒤 코딩 대화의 다시 말한 지시 비율: 줄어듦 2.9%p"
const effectText = (task: string, d: number | null) =>
  `그 뒤 ${task === 'all' ? '전체' : `${taskLabel(task)} 대화의`} 다시 말한 지시 비율: ${d == null ? '아직 잴 메시지가 부족합니다' : Math.abs(d) < 0.05 ? '그대로' : d < 0 ? `줄어듦 ${d.toFixed(1)}%p` : `늘어남 +${d.toFixed(1)}%p`}`
const pct = (r: Pick<AnalysisRecord, 'judgeable' | 'high'>) => (r.judgeable ? `${((100 * r.high) / r.judgeable).toFixed(1)}%` : '-')

/** 전후 비교: 지난 분석 기록(그때 숫자·추천)과 지금. 비율 변화는 지금 분석을 지난 기록의 마지막 메시지 시각으로 나눠 잰다. */
export default function History({ cur, prevs, sel, onSel, cmp, installed, onClear }: {
  cur: AnalysisRecord; prevs: AnalysisRecord[]; sel: number; onSel: (i: number) => void; cmp: TaskCompare | null; installed: string[]; onClear: () => void
}) {
  const prev = prevs[sel]
  if (!prev) return <p className="detail">이번 분석을 기록했습니다({day(cur.savedAt)}). 다음에 새 내보내기를 올리면 지금과 비교해 보여 줍니다.</p>
  const newMsgs = cmp?.total.after.ok ?? 0
  const now = new Set([...cur.rx, ...cur.plugins])
  const applied = new Set(prev.applied ?? [])
  const keys = [...new Set([...prev.rx, ...prev.plugins, ...applied])]
  const was = keys.map((k) => ({ key: k, name: prev.rx.includes(k) || k.startsWith('prompt:') ? rxName(k) : k, applied: applied.has(k), eff: effectOf(cmp, prev.tasks?.[k]) }))
    .sort((a, b) => Number(b.applied) - Number(a.applied))
  return (
    <div>
      <p className="detail">
        지난 기록{' '}
        <select value={sel} onChange={(e) => onSel(Number(e.target.value))}>
          {prevs.map((r, i) => <option key={r.savedAt} value={i}>{day(r.savedAt)} 분석 (~{day(r.lastAt)})</option>)}
        </select>
        {' '}→ 지금(~{day(cur.lastAt)}). 그 뒤 내 메시지 {newMsgs}개.
        <Help text="저장하는 것은 분석할 때의 숫자와 추천한 항목 이름뿐이고 대화 내용은 없습니다. 비율 변화는 지금 분석을 지난 기록의 마지막 메시지 날짜로 나눠, 같은 방식으로 앞뒤를 잽니다. 변한 이유는 판정하지 않습니다." />
      </p>
      <table>
        <thead><tr><th></th><th>지난 기록</th><th>지금</th></tr></thead>
        <tbody>
          <tr><td>다시 말한 지시(확실함)</td><td>{prev.high}건 / {prev.judgeable}개 ({pct(prev)})</td><td>{cur.high}건 / {cur.judgeable}개 ({pct(cur)})</td></tr>
          <tr><td>추천</td><td>{prev.rx.length + prev.plugins.length}개</td><td>{cur.rx.length + cur.plugins.length}개</td></tr>
        </tbody>
      </table>
      {cmp && newMsgs > 0
        ? <><p className="label">지난 기록 전 → 후</p><CompareTable cmp={cmp} before="전" after="후" /></>
        : <p className="detail">지난 기록 뒤로 새 메시지가 없어 비율 변화는 아직 잴 수 없습니다.</p>}
      {was.length > 0 && (
        <>
          <p className="label">지난번 추천은 지금<Help text="'적용함'은 지난 분석 화면에서 직접 표시한 항목입니다. 비율 변화는 그 항목이 겨냥한 대화 종류를 지난 기록 전과 후로 나눠 잰 값이고, 그 항목 때문에 바뀌었다고 판정하지는 않습니다." /></p>
          <ul className="history">
            {was.map((w) => (
              <li key={w.key}>
                <b>{w.name}</b>{' '}
                {w.applied && <span className="tag have">적용함</span>}{' '}
                {isInstalled(w.name, installed) ? '설치함' : now.has(w.key) ? '이번에도 추천' : w.key.startsWith('prompt:') ? '' : '이번엔 추천에서 빠짐'}
                {newMsgs > 0 && <span className="detail"> · {effectText(w.eff.task, w.eff.delta)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="detail"><button onClick={onClear}>분석 기록 지우기</button></p>
    </div>
  )
}

/** 추천 카드 안 한 줄: 지난 기록에서도 추천했는지, 그 뒤 비율이 어떻게 됐는지 */
export function RepeatLine({ note }: { note?: RepeatNote }) {
  if (!note) return null
  return <p className="detail">{day(note.since)} 기록에서도 추천했습니다{note.applied ? '(적용함으로 표시)' : ''}. {effectText(note.task, note.delta)}.</p>
}
