import { CATALOG, GOALS, PLANS, type Platform, type UserContext } from './recommend'
import type { DetectedFeature } from './detectFeatures'

// 체크리스트: 요금제, 목표(선택), 그리고 파일에서 자동 감지한 사용 기능(해제 가능). 사용 기능을 묻지 않는다.
export const CONTEXT_KEY = 'relog-user-context-v1'
const EMPTY: UserContext = { plan: 'free', featuresInUse: [], goals: [], ignored: [] }
export const loadContext = (platform: Platform): UserContext => {
  try {
    const all = JSON.parse(localStorage.getItem(CONTEXT_KEY) ?? '{}')
    return { ...EMPTY, ...(all[platform] ?? {}) }
  } catch { return EMPTY }
}
export const saveContext = (platform: Platform, ctx: UserContext) => {
  try {
    const all = JSON.parse(localStorage.getItem(CONTEXT_KEY) ?? '{}')
    localStorage.setItem(CONTEXT_KEY, JSON.stringify({ ...all, [platform]: ctx }))
  } catch { /* 저장 불가 환경은 무시 */ }
}

// 저장된 설정 + 감지 결과 → 실제 입력. 사용자가 해제한(ignored) 감지 항목은 뺀다.
export const withDetected = (ctx: UserContext, detected: DetectedFeature[]): UserContext => ({
  ...ctx,
  featuresInUse: [...new Set([...ctx.featuresInUse, ...detected.map((d) => d.catalogId)])].filter((id) => !(ctx.ignored ?? []).includes(id)),
})

export default function Checklist({ platform, value, detected, onChange }: { platform: Platform; value: UserContext; detected: DetectedFeature[]; onChange: (c: UserContext) => void }) {
  const nameOf = (id: string) => CATALOG.find((c) => c.id === id)?.name ?? id
  const toggleGoal = (g: string) => { const gs = value.goals ?? []; onChange({ ...value, goals: gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g] }) }
  const toggleIgnore = (id: string) => { const ig = value.ignored ?? []; onChange({ ...value, ignored: ig.includes(id) ? ig.filter((x) => x !== id) : [...ig, id] }) }
  return (
    <div className="checklist">
      <div className="row">
        <span>요금제</span>
        {PLANS[platform].map((p) => (
          <label key={p.id}><input type="radio" name="plan" checked={value.plan === p.id} onChange={() => onChange({ ...value, plan: p.id })} /> {p.label}</label>
        ))}
      </div>
      <div className="row wrap">
        <span>쓰는 기능</span>
        {detected.length === 0 && <em className="detail">파일에서 감지된 기능 없음</em>}
        {detected.map((d) => (
          <label key={d.catalogId} title={`대화 ${d.conversations}개에서 감지. 아니면 체크 해제`}>
            <input type="checkbox" checked={!(value.ignored ?? []).includes(d.catalogId)} onChange={() => toggleIgnore(d.catalogId)} /> {nameOf(d.catalogId)} <em className="detail">({d.conversations})</em>
          </label>
        ))}
      </div>
      <p className="detail">파일의 도구 호출 흔적으로 추정한 것이라 메모리·프로젝트 지침처럼 흔적이 없는 기능은 못 잡습니다. 그런 건 추천 카드에서 "이미 씀"을 누르면 됩니다. 설정은 이 브라우저에만 저장됩니다.</p>
      <div className="row wrap">
        <span>목표 (선택)</span>
        {GOALS.map((g) => (
          <label key={g}><input type="checkbox" checked={value.goals?.includes(g) ?? false} onChange={() => toggleGoal(g)} /> {g}</label>
        ))}
      </div>
    </div>
  )
}
