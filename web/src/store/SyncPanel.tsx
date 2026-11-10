import { useEffect, useState } from 'react'
import { API_BASE, deleteMe, getToken, login, logout, me, register, upsertSnapshots } from './sync'
import type { AnalysisVersion, PeriodSnapshot } from './ledger'

// 서버 동기화 모드: 서비스 계정으로 로그인하고 주별 집계 숫자만 보낸다. 삭제 버튼으로 서버 데이터 전부 제거.
export default function SyncPanel({ weeks, version }: { weeks: PeriodSnapshot[]; version: AnalysisVersion | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [who, setWho] = useState<{ email: string; snapshots: number } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (getToken()) me().then(setWho).catch(() => setWho(null)) }, [])

  async function run(label: string, f: () => Promise<unknown>) {
    setBusy(true); setMsg('')
    try { await f(); setMsg(label + ' 완료') } catch (e) { setMsg(label + ' 실패: ' + (e as Error).message) } finally { setBusy(false) }
  }
  const refresh = () => me().then(setWho).catch(() => setWho(null))

  return (
    <div className="checklist">
      <p className="detail">서버({API_BASE})에는 주별 집계 숫자(발화 수·유형 수·반복 의심 수·토큰 추정치)와 피드백만 보냅니다. 대화 내용·임베딩·플랫폼 계정 정보는 보내지 않습니다. 서비스 계정이 필요합니다.</p>
      {!who ? (
        <div className="row wrap">
          <input placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="비밀번호(8자 이상)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button disabled={busy} onClick={() => run('로그인', async () => { await login(email, password); await refresh() })}>로그인</button>
          <button disabled={busy} onClick={() => run('가입', async () => { await register(email, password); await refresh() })}>가입</button>
        </div>
      ) : (
        <div className="row wrap">
          <span>{who.email} · 서버 스냅샷 {who.snapshots}주</span>
          <button disabled={busy || !version || weeks.length === 0} onClick={() => run('동기화', async () => { const r = await upsertSnapshots(weeks, version!); setMsg(`동기화 완료: 새 기간 ${r.created}, 덮어쓴 기간 ${r.updated}`); await refresh() })}>지금 동기화 ({weeks.length}주)</button>
          <button disabled={busy} onClick={() => { logout(); setWho(null) }}>로그아웃</button>
          <button disabled={busy} onClick={() => { if (confirm('서버에 저장된 내 데이터(스냅샷·추천·피드백·계정)를 모두 지웁니다. 계속할까요?')) run('서버 데이터 삭제', async () => { await deleteMe(); setWho(null) }) }}>서버 데이터 삭제</button>
        </div>
      )}
      {msg && <p className="detail">{msg}</p>}
    </div>
  )
}
