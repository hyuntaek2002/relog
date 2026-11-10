import { useState } from 'react'
import { NO_RECOMMENDATION, type Feedback, type FeedbackMap, type Prescription } from './recommend'

// 추천 카드 0~3개: 한 줄 요약 → 무엇을 → 이렇게 하세요(번호) → 작은 주의. 근거 숫자는 펼침. 피드백은 로컬 저장.
export const FEEDBACK_KEY = 'relog-feedback-v1'
export const loadFeedback = (): FeedbackMap => { try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? '{}') } catch { return {} } }
export const saveFeedback = (f: FeedbackMap) => { try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(f)) } catch { /* 무시 */ } }

const FB: [Feedback, string][] = [['helpful', '도움됨'], ['not_helpful', '아님'], ['already_using', '이미 씀']]
const CATEGORY: Record<string, string> = { feature: '기능', plugin: '플러그인', connector: '연결', skill: '스킬', practice: '습관' }

// "1) … 2) … 3) …" 형식의 30초 사용법을 단계 배열로
const steps = (how: string) => how.split(/\s*\d\)\s*/).map((s) => s.trim()).filter(Boolean)

export default function Prescriptions({ items, feedback, onFeedback }: { items: Prescription[]; feedback: FeedbackMap; onFeedback: (id: string, f: Feedback) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (items.length === 0) return <p className="detail">{NO_RECOMMENDATION}</p>
  return (
    <div>
      {items.map((p) => (
        <article className="rx" key={p.catalogId}>
          <header className="meta">
            <b>{p.name}</b>
            {(CATEGORY[p.category] ?? p.category) !== p.name && <span className="tag">{CATEGORY[p.category] ?? p.category}</span>}
            <span className={p.grade === '핵심' ? 'grade-high' : 'grade-low'}>{p.grade === '핵심' ? '지금 필요' : '참고'}</span>
          </header>
          <p className="lead">{p.summary} {p.what}</p>
          <p className="steps-title">이렇게 하세요</p>
          <ol className="rx-steps">
            {steps(p.how).map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <p className="detail">{p.caveat}</p>
          <p className="actions">
            {FB.map(([f, label]) => (
              <button key={f} className={feedback[p.catalogId] === f ? 'on' : ''} onClick={() => onFeedback(p.catalogId, f)}>{label}</button>
            ))}
            <button className="link" onClick={() => setOpen((o) => ({ ...o, [p.catalogId]: !o[p.catalogId] }))}>{open[p.catalogId] ? '근거 숨기기' : '왜 이 추천?'}</button>
          </p>
          {open[p.catalogId] && (
            <div className="detail">
              <p>{p.why}</p>
              <ul>{p.signalsUsed.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
