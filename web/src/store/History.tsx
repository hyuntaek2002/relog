import Help from '../ui/Help'
import { CATALOG } from '../recommend/recommend'
import { isInstalled } from '../recommend/taskPluginRules'
import { CompareTable } from './Trend'
import { habitText, type TaskCompare } from './ledger'
import { TASK_LABELS } from '../classify/classifier'
import { ledgerTask, type AnalysisRecord, type RepeatNote } from './records'

const day = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
const taskLabel = (t: string) => (TASK_LABELS as Record<string, string>)[t] ?? t
export const rxName = (id: string) => id.startsWith('prompt:') ? `${taskLabel(ledgerTask(id.slice(7)))} 시작 문구` : CATALOG.find((c) => c.id === id)?.name ?? id
const avg = (r: Pick<AnalysisRecord, 'conversations' | 'userTurns'>) => (r.conversations ? `${((r.userTurns ?? 0) / r.conversations).toFixed(1)}개` : '-')
const longPct = (r: Pick<AnalysisRecord, 'conversations' | 'longConversations'>) => (r.conversations ? `${((100 * (r.longConversations ?? 0)) / r.conversations).toFixed(0)}%` : '-')


/** 전후 비교: 지난 분석 기록(그때 숫자·추천)과 지금. 변화는 지금 분석을 지난 기록의 마지막 메시지 시각으로 나눠 잰다. */
export default function History({ cur, prevs, sel, onSel, cmp, installed, onClear }: {
  cur: AnalysisRecord; prevs: AnalysisRecord[]; sel: number; onSel: (i: number) => void; cmp: TaskCompare | null; installed: string[]; onClear: () => void
}) {
  const prev = prevs[sel]
  if (!prev) return <p className="detail">이번 분석을 기록했습니다({day(cur.savedAt)}). 다음에 새 내보내기를 올리면 지금과 비교해 보여 줍니다.</p>
  const newMsgs = cmp?.habits.after.ok ?? 0
  const now = new Set([...cur.rx, ...cur.plugins])
  const using = new Set(cur.applied ?? [])
  const keys = [...new Set([...prev.rx, ...prev.plugins])]
  const was = keys.map((k) => ({ key: k, name: prev.rx.includes(k) || k.startsWith('prompt:') ? rxName(k) : k, using: using.has(k) }))
    .sort((a, b) => Number(b.using) - Number(a.using))
  return (
    <div>
      <p className="detail">
        지난 기록{' '}
        <select value={sel} onChange={(e) => onSel(Number(e.target.value))}>
          {prevs.map((r, i) => <option key={r.savedAt} value={i}>{day(r.savedAt)} 분석 (~{day(r.lastAt)})</option>)}
        </select>
        {' '}→ 지금(~{day(cur.lastAt)}). 그 뒤 내 메시지 {newMsgs}개.
        <Help text="저장하는 것은 분석할 때의 숫자와 추천한 항목 이름, 쓰고 있음 표시뿐이고 대화 내용은 없습니다. 변화는 지금 분석을 지난 기록의 마지막 메시지 날짜로 나눠, 같은 방식으로 앞뒤를 잽니다. 변한 이유는 판정하지 않습니다." />
      </p>
      <table>
        <thead><tr><th></th><th>지난 기록</th><th>지금</th></tr></thead>
        <tbody>
          <tr><td>대화 · 내 메시지</td><td>{prev.conversations ?? '-'}개 · {prev.userTurns ?? '-'}개</td><td>{cur.conversations}개 · {cur.userTurns}개</td></tr>
          <tr><td>대화당 내 메시지</td><td>{avg(prev)}</td><td>{avg(cur)}</td></tr>
          <tr><td>긴 대화 비율</td><td>{longPct(prev)}</td><td>{longPct(cur)}</td></tr>
          <tr><td>추천 · 쓰고 있음</td><td>{prev.rx.length + prev.plugins.length}개 · {(prev.applied ?? []).length}개</td><td>{cur.rx.length + cur.plugins.length}개 · {using.size}개</td></tr>
        </tbody>
      </table>
      {cmp && newMsgs > 0
        ? <><p className="label">지난 기록 전 → 후</p><p className="detail">{habitText(cmp.habits.before, cmp.habits.after)}</p><CompareTable cmp={cmp} before="전" after="후" /></>
        : <p className="detail">지난 기록 뒤로 새 메시지가 없어 변화는 아직 잴 수 없습니다.</p>}
      {was.length > 0 && (
        <>
          <p className="label">지난번 추천은 지금<Help text="'쓰고 있음'은 직접 표시한 항목입니다. 그 항목 때문에 대화 습관이 바뀌었다고 판정하지는 않습니다." /></p>
          <ul className="history">
            {was.map((w) => (
              <li key={w.key}>
                <b>{w.name}</b>{' '}
                {w.using && <span className="tag have">쓰고 있음</span>}{' '}
                {isInstalled(w.name, installed) ? '설치함' : now.has(w.key) ? '이번에도 추천' : w.key.startsWith('prompt:') ? '' : '이번엔 추천에서 빠짐'}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="detail"><button onClick={onClear}>분석 기록 지우기</button></p>
    </div>
  )
}

/** 추천 카드 안 효과 칸: 위 줄은 '지난 기록 뒤 [쓰고 있음]', 아래 줄에 대화 습관 변화와 날짜를 작게 */
export function RepeatLine({ note }: { note?: RepeatNote }) {
  if (!note) return null
  return (
    <div className="eff">
      <p className="eff-top"><span>지난 기록 뒤</span>{note.applied && <span className="tag have">쓰고 있음</span>}{!note.habits && <span className="eff-badge">잴 메시지 부족</span>}</p>
      <p className="eff-sub">{day(note.since)} 기록에서도 추천{note.habits && ` · ${habitText(note.habits.before, note.habits.after)}`}</p>
    </div>
  )
}
