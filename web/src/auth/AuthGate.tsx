import { useEffect, useState, type ReactNode } from 'react'
import { getToken, login, logout, me, register } from '../store/sync'
import MyRecords from '../store/MyRecords'

// 로그인해야 쓸 수 있게 막는 화면(2026-11-18 결정: 서버 없는 배포판도 포함). 가입·로그인에는 이메일과 비밀번호만 쓰고,
// 대화 분석은 그대로 브라우저 안에서만 한다. 토큰이 없거나 서버가 거절하면(401) 로그인 화면으로 돌아온다.
type State = { kind: 'checking' } | { kind: 'out'; msg?: string } | { kind: 'offline' } | { kind: 'in'; email: string; createdAt: string }

export default function AuthGate({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<State>({ kind: 'checking' })
  const [mine, setMine] = useState(false) // 내 기록 펼침
  const check = () => {
    if (!getToken()) { setSt({ kind: 'out' }); return }
    setSt({ kind: 'checking' })
    me().then((w) => setSt({ kind: 'in', email: w.email, createdAt: w.createdAt })).catch((e: Error) => setSt(getToken() ? { kind: 'offline' } : { kind: 'out', msg: e.message }))
  }
  useEffect(check, [])

  if (st.kind === 'in') return (
    <>
      <div className="authbar"><span>{st.email}</span><button onClick={() => setMine(!mine)}>{mine ? '내 기록 닫기' : '내 기록'}</button><button onClick={() => { logout(); setMine(false); setSt({ kind: 'out' }) }}>로그아웃</button></div>
      {mine && <main className="myrec-wrap"><MyRecords email={st.email} createdAt={st.createdAt} /></main>}
      {children}
    </>
  )
  return (
    <main className="authpage">
      <h1>relog</h1>
      <p className="sub">이 브라우저 안에서만 분석합니다. 대화 내용은 어디로도 보내지 않습니다.</p>
      {st.kind === 'checking' && <p className="detail">로그인 상태를 확인하고 있습니다.</p>}
      {st.kind === 'offline' && <p className="err">서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요. <button onClick={check}>다시 시도</button></p>}
      {st.kind === 'out' && <AuthForm initialMsg={st.msg} onDone={check} />}
    </main>
  )
}

function AuthForm({ initialMsg, onDone }: { initialMsg?: string; onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState(initialMsg && initialMsg !== '로그인이 필요합니다' ? initialMsg : '')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 8) { setMsg('비밀번호는 8자 이상이어야 합니다.'); return }
    if (mode === 'register' && pw !== pw2) { setMsg('비밀번호 확인이 다릅니다.'); return }
    setBusy(true); setMsg('')
    try { await (mode === 'login' ? login : register)(email.trim(), pw); onDone() } catch (err) { setMsg((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <form className="auth" onSubmit={submit}>
      <div className="authtabs">
        <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setMsg('') }}>로그인</button>
        <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setMsg('') }}>회원가입</button>
      </div>
      <label>이메일<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>비밀번호(8자 이상)<input type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      {mode === 'register' && <label>비밀번호 확인<input type="password" required minLength={8} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>}
      <button type="submit" disabled={busy}>{mode === 'login' ? '로그인' : '가입하고 시작하기'}</button>
      {msg && <p className="err">{msg}</p>}
      <p className="detail">가입에는 이메일과 비밀번호만 씁니다. 대화 내용은 서버로 보내지 않습니다. 로그인하면 분석 기록(요약 숫자, 추천한 항목 이름, 내가 누른 적용함 표시)이 계정에 저장되어 다음 분석 때 전후 비교에 쓰이며, 변화 탭에서 지울 수 있습니다.</p>
    </form>
  )
}
