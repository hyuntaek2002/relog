import { useEffect, useState } from 'react'
import { TASK_LABELS } from '../classify/classifier'
import { steps } from '../recommend/Prescriptions'
import { CompareTable } from '../store/Trend'
import { fetchTrend, getToken, latestRecommendations, listSnapshots, login, logout, me, type ServerWeek, type StoredPrescription } from '../store/sync'
import type { TaskCompare } from '../store/ledger'

// 최소 뷰어(?view=1): 서버에 보관된 집계 통계와 최근 처방만 열람한다. 파일을 올리거나 분석하지 않는다.
// 휴대폰 홈 화면에 추가해 앱처럼 열 수 있게 manifest를 둔다(내부 테스트용).
const taskName = (t: string) => (t === 'other' ? '기타' : (TASK_LABELS as Record<string, string>)[t] ?? t)
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

interface Data { email: string; weeks: ServerWeek[]; rx: StoredPrescription[]; rxAt?: string; trend: (TaskCompare & { weeks: number }) | null }

export default function Viewer() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setBusy(true); setMsg('')
    try {
      const [who, all, rec, trend] = await Promise.all([me(), listSnapshots(), latestRecommendations(), fetchTrend(2)])
      // 가장 최근에 올린 분석 버전의 주들만 본다(버전이 다른 기간끼리는 합치지 않음)
      const vk = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.versionKey
      setData({ email: who.email, weeks: all.filter((w) => w.versionKey === vk), rx: rec.prescriptions, rxAt: rec.createdAt, trend })
    } catch (e) { setData(null); setMsg((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => { if (getToken()) load() }, [])

  if (!data) {
    return (
      <main className="viewer">
        <h1>relog 뷰어</h1>
        <p className="sub">서버에 보관한 집계 통계와 최근 추천만 봅니다. 대화 내용은 서버에 없습니다.</p>
        <div className="checklist">
          <div className="row wrap">
            <input placeholder="이메일" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input placeholder="비밀번호" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button disabled={busy} onClick={async () => { setBusy(true); try { await login(email, password); await load() } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) } }}>로그인</button>
          </div>
        </div>
        {msg && <p className="err">{msg}</p>}
      </main>
    )
  }

  const sum = (f: (w: ServerWeek) => number) => data.weeks.reduce((a, w) => a + f(w), 0)
  const flagged = sum((w) => w.restatement.high) // 확실함만 센다(det-0.4.1)
  const judgeable = sum((w) => w.judgeable)
  const ok = sum((w) => w.okCount)
  const tasks: Record<string, number> = {}
  for (const w of data.weeks) for (const [t, n] of Object.entries(w.taskCounts)) tasks[t] = (tasks[t] ?? 0) + n
  const taskRows = Object.entries(tasks).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  return (
    <main className="viewer">
      <h1>relog 뷰어</h1>
      <p className="sub">{data.email} <button className="link" onClick={() => { logout(); setData(null) }}>로그아웃</button> <button className="link" disabled={busy} onClick={load}>새로 고침</button></p>
      {data.weeks.length === 0 ? <p className="detail">서버에 보관된 집계가 없습니다. 분석 화면의 "서버 동기화"에서 집계를 보내 주세요.</p> : (
        <>
          <p className="strip">{fmtDay(data.weeks[0].periodStart)} ~ {fmtDay(data.weeks[data.weeks.length - 1].periodEnd - 1)} · {data.weeks.length}주 · 내 메시지 <b>{sum((w) => w.userTurnCount).toLocaleString()}</b></p>
          <div className="cards three">
            <div className="card"><b>{flagged}</b><span>다시 말한 지시</span><small>확실함만 셉니다. 참고: 가능성 있음 {sum((w) => w.restatement.medium)} · 약함 {sum((w) => w.restatement.low)}</small></div>
            <div className="card"><b>{judgeable ? ((100 * flagged) / judgeable).toFixed(1) : '0'}%</b><span>비교한 내 메시지 {judgeable}개 중</span></div>
            <div className="card"><b>{sum((w) => w.restatement.tokenEstimate).toLocaleString()}</b><span>다시 친 분량 (토큰, 추정)</span></div>
          </div>
          <p className="label">대화 종류</p>
          <ul className="bars">
            {taskRows.map(([t, n]) => <li key={t}><span>{taskName(t)}</span><i style={{ width: `${(100 * n) / Math.max(1, ok)}%` }} /><em>{Math.round((100 * n) / Math.max(1, ok))}%</em></li>)}
          </ul>
        </>
      )}
      <p className="label">추천{data.rxAt && <span className="detail"> · {data.rxAt.slice(0, 10)}</span>}</p>
      {data.rx.length === 0 && <p className="detail">서버에 남은 추천이 없습니다.</p>}
      {data.rx.map((p) => (
        <article className="rx" key={p.catalogId}>
          <header className="meta"><b>{p.name}</b><span className={p.grade === '핵심' ? 'grade-high' : 'grade-low'}>{p.grade === '핵심' ? '지금 필요' : '참고'}</span></header>
          <p className="lead">{p.summary} {p.what}</p>
          <ol className="rx-steps">{steps(p.how).map((s, i) => <li key={i}>{s}</li>)}</ol>
        </article>
      ))}
      {data.trend && data.trend.beforeRange && data.trend.afterRange && (
        <>
          <p className="label">변화 (이전 → 최근 2주)</p>
          <CompareTable cmp={data.trend} before="이전" after="최근" />
        </>
      )}
      {msg && <p className="err">{msg}</p>}
    </main>
  )
}
