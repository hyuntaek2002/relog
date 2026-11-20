import { useEffect, useState } from 'react'
import Help from '../ui/Help'
import { rxName } from './History'
import { sinceLast, type AnalysisRecord, type SinceLast } from './records'
import { listServerRecords } from './sync'

// 내 기록: 로그인한 계정에 서버로 보관된 분석 기록만 보여 준다(파일을 올리지 않아도 됨).
// 기록에는 요약 숫자·추천한 항목 이름·적용함 표시만 있고 대화 내용은 없다.
const day = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
const num = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }) // 표 안은 짧게
const SERVICE = { chatgpt: 'ChatGPT', claude: 'Claude' } as const
const pct = (r: AnalysisRecord) => (r.judgeable ? `${((100 * r.high) / r.judgeable).toFixed(1)}%` : '-')
const name = (k: string) => (k.startsWith('prompt:') || /^(cg|cl|pr)_/.test(k) ? rxName(k) : k)

function Since({ s }: { s: SinceLast }) {
  if (s === 'first') return <span className="detail">첫 기록</span>
  if (s === 'version') return <span className="detail">분석 방식이 달라 비교하지 않음</span>
  if (s === 'none') return <span className="detail">새 메시지 없음</span>
  const d = s.delta
  return (
    <>
      새 메시지 {s.judgeable}개 중 {s.high}건({s.ratio.toFixed(1)}%)
      {d != null && <span className="detail"> · 직전보다 {Math.abs(d) < 0.05 ? '그대로' : d < 0 ? `줄어듦 ${Math.abs(d).toFixed(1)}%p` : `늘어남 +${d.toFixed(1)}%p`}</span>}
    </>
  )
}

export default function MyRecords({ email, createdAt }: { email: string; createdAt: string }) {
  const [rs, setRs] = useState<AnalysisRecord[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { listServerRecords().then(setRs).catch((e: Error) => setErr(e.message)) }, [])

  const asc = [...(rs ?? [])].sort((a, b) => a.savedAt - b.savedAt)
  // 같은 서비스의 직전 기록과 비교(마지막 메시지 시각 순)
  const prevOf = (r: AnalysisRecord) => asc.filter((p) => p.platform === r.platform && p.lastAt < r.lastAt).sort((a, b) => b.lastAt - a.lastAt)[0]
  const rows = [...asc].reverse()
  const applied = [...new Set(rows.flatMap((r) => r.applied ?? []))]
  const count = (p: 'chatgpt' | 'claude') => asc.filter((r) => r.platform === p).length

  return (
    <section className="myrec">
      <h2>내 기록</h2>
      <p className="detail">
        {email} · {day(Date.parse(createdAt))} 가입
        {rs && <> · 분석 {rs.length}회{rs.length > 0 && ` (ChatGPT ${count('chatgpt')} · Claude ${count('claude')}) · ${day(asc[0].savedAt)} ~ ${day(asc[asc.length - 1].savedAt)}`}</>}
        <Help text="이 계정으로 분석할 때마다 서버에 남긴 요약 숫자, 추천한 항목 이름, 직접 누른 적용함 표시만 보여 줍니다. 대화 내용은 저장하지 않습니다. '직전 기록 뒤'는 같은 서비스의 두 기록 숫자 차이로 잰 추정이고, 변한 이유는 판정하지 않습니다. 대화 종류별로 자세히 보려면 새 내보내기를 올려 '변화' 탭을 보세요." />
      </p>
      {err && <p className="err">기록을 불러오지 못했습니다: {err}</p>}
      {rs && rs.length === 0 && <p className="detail">아직 분석 기록이 없습니다. 내보내기 파일을 분석하면 여기에 쌓입니다.</p>}
      {rows.length > 0 && (
        <table>
          <thead><tr><th>분석한 날</th><th>서비스</th><th>대화 기간</th><th>다시 말한 지시(확실함)</th><th>직전 기록 뒤</th><th>추천 · 적용함</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.platform}-${r.lastAt}`}>
                <td>{num(r.savedAt)}</td>
                <td>{SERVICE[r.platform]}</td>
                <td>{num(r.firstAt)} ~ {num(r.lastAt)}</td>
                <td>{r.high}건 / {r.judgeable}개 ({pct(r)})</td>
                <td><Since s={sinceLast(prevOf(r), r)} /></td>
                <td>{r.rx.length + r.plugins.length}개 · {(r.applied ?? []).length}개</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {applied.length > 0 && <p className="detail">적용함으로 표시한 항목: {applied.map(name).join(', ')}</p>}
    </section>
  )
}
