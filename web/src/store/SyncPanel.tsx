import { useEffect, useState } from 'react'
import { API_BASE, deleteMe, fetchRecommendations, fetchTrend, getToken, login, logout, me, register, setNotify, upsertSnapshots } from './sync'
import type { AnalysisVersion, PeriodSnapshot, TaskCompare } from './ledger'
import type { Prescription, UserContext } from '../recommend/recommend'
import type { UsageSnapshot } from '../recommend/snapshot'
import Help from '../ui/Help'

// 서버 동기화(선택): 서비스 계정으로 로그인하고 주별 집계 숫자만 보낸다. 보낸 뒤 서버가 추천과 변화 추이를 계산해 돌려준다.
// 로그인하지 않으면 아무것도 보내지 않고 전부 브라우저 안에서 계산한다.
export default function SyncPanel({ weeks, version, snapshot, ctx, onServer }: {
  weeks: PeriodSnapshot[]
  version: AnalysisVersion | null
  snapshot: UsageSnapshot | null
  ctx: UserContext | null
  onServer: (r: { prescriptions: Prescription[] | null; trend: (TaskCompare & { weeks: number }) | null }) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [who, setWho] = useState<{ email: string; snapshots: number; notify: boolean } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (getToken()) me().then(setWho).catch(() => setWho(null)) }, [])

  async function run(label: string, f: () => Promise<string | void>) {
    setBusy(true); setMsg('')
    try { setMsg((await f()) ?? `${label} 완료`) } catch (e) { setMsg(`${label} 실패: ${(e as Error).message}`) } finally { setBusy(false) }
  }
  const refresh = () => me().then(setWho).catch(() => setWho(null))
  const signOut = () => { logout(); setWho(null); onServer({ prescriptions: null, trend: null }) }

  // 집계 전송 → 서버 추천 → 서버 변화 추이 순서. 추천·추이는 서버가 계산한 값을 화면에 쓴다.
  async function sync() {
    const r = await upsertSnapshots(weeks, version!)
    const rx = snapshot && ctx ? (await fetchRecommendations(snapshot, ctx)).prescriptions : null
    const trend = await fetchTrend(2)
    onServer({ prescriptions: rx, trend })
    await refresh()
    return `보냈습니다: 새 기간 ${r.created}주, 덮어쓴 기간 ${r.updated}주. 추천과 변화는 서버 계산값으로 바꿨습니다.`
  }

  return (
    <div className="checklist">
      <div className="row wrap">
        <span>서버<Help text={`서버(${API_BASE})에는 주별 집계 숫자(메시지 수·대화 종류별 수·다시 말한 지시 수·토큰 추정치)와 요금제·쓰는 기능·피드백만 보냅니다. 대화 내용과 임베딩은 보내지 않고, ChatGPT·Claude 계정 정보도 다루지 않습니다. 이 서비스용 계정(이메일)이 필요합니다.`} /></span>
        {!who ? (
          <>
            <input placeholder="이메일" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input placeholder="비밀번호(8자 이상)" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button disabled={busy} onClick={() => run('로그인', async () => { await login(email, password); await refresh() })}>로그인</button>
            <button disabled={busy} onClick={() => run('가입', async () => { await register(email, password); await refresh() })}>가입</button>
          </>
        ) : (
          <>
            <span>{who.email} · 서버 보관 {who.snapshots}주</span>
            <button disabled={busy || !version || weeks.length === 0} onClick={() => run('보내기', sync)}>집계 보내기 ({weeks.length}주)</button>
            <label title="수신 여부만 저장합니다. 알림 발송 기능은 아직 없습니다."><input type="checkbox" checked={who.notify} disabled={busy} onChange={(e) => run('알림 설정', async () => { await setNotify(e.target.checked); await refresh() })} /> 알림 받기</label>
            <button disabled={busy} onClick={signOut}>로그아웃</button>
            <button disabled={busy} onClick={() => { if (confirm('서버에 저장된 내 데이터(주별 집계·추천 이력·피드백·계정)를 모두 지웁니다. 계속할까요?')) run('서버 데이터 삭제', async () => { await deleteMe(); setWho(null); onServer({ prescriptions: null, trend: null }) }) }}>서버 데이터 삭제</button>
          </>
        )}
      </div>
      {msg && <p className="detail">{msg}</p>}
    </div>
  )
}
