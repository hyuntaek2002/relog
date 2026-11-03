import { CATALOG, GOALS, PLANS, type Platform, type UserContext } from './recommend'

// 체크리스트: 요금제, 이미 쓰는 기능, 목표(선택). 저장은 로컬(localStorage)만.
export const CONTEXT_KEY = 'relog-user-context-v1'
export const loadContext = (platform: Platform): UserContext => {
  try {
    const all = JSON.parse(localStorage.getItem(CONTEXT_KEY) ?? '{}')
    return all[platform] ?? { plan: 'free', featuresInUse: [], goals: [] }
  } catch { return { plan: 'free', featuresInUse: [], goals: [] } }
}
export const saveContext = (platform: Platform, ctx: UserContext) => {
  try {
    const all = JSON.parse(localStorage.getItem(CONTEXT_KEY) ?? '{}')
    localStorage.setItem(CONTEXT_KEY, JSON.stringify({ ...all, [platform]: ctx }))
  } catch { /* 저장 불가 환경은 무시 */ }
}

export default function Checklist({ platform, value, onChange }: { platform: Platform; value: UserContext; onChange: (c: UserContext) => void }) {
  const features = CATALOG.filter((c) => c.verified && c.category !== 'practice' && (c.platform === platform || c.platform === 'both'))
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  return (
    <div className="checklist">
      <p className="detail">{platform === 'chatgpt' ? 'ChatGPT' : 'Claude'} 요금제와 이미 쓰는 기능을 골라 주세요. 처방에서 제외하는 데만 쓰고, 이 브라우저에만 저장됩니다.</p>
      <div className="row">
        <span>요금제</span>
        {PLANS[platform].map((p) => (
          <label key={p.id}><input type="radio" name="plan" checked={value.plan === p.id} onChange={() => onChange({ ...value, plan: p.id })} /> {p.label}</label>
        ))}
      </div>
      <div className="row wrap">
        <span>이미 쓰는 기능</span>
        {features.map((f) => (
          <label key={f.id}><input type="checkbox" checked={value.featuresInUse.includes(f.id)} onChange={() => onChange({ ...value, featuresInUse: toggle(value.featuresInUse, f.id) })} /> {f.name}</label>
        ))}
      </div>
      <div className="row wrap">
        <span>목표 (선택)</span>
        {GOALS.map((g) => (
          <label key={g}><input type="checkbox" checked={value.goals?.includes(g) ?? false} onChange={() => onChange({ ...value, goals: toggle(value.goals ?? [], g) })} /> {g}</label>
        ))}
      </div>
    </div>
  )
}
