import { useState } from 'react'
import { NO_RECOMMENDATION, type Feedback, type FeedbackMap, type Prescription } from './recommend'

// 처방 카드 0~3개 + 피드백(도움됨/아님/이미 씀). 피드백은 로컬 저장.
export const FEEDBACK_KEY = 'relog-feedback-v1'
export const loadFeedback = (): FeedbackMap => { try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? '{}') } catch { return {} } }
export const saveFeedback = (f: FeedbackMap) => { try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(f)) } catch { /* 무시 */ } }

const FB: [Feedback, string][] = [['helpful', '도움됨'], ['not_helpful', '아님'], ['already_using', '이미 씀']]

export default function Prescriptions({ items, feedback, onFeedback }: { items: Prescription[]; feedback: FeedbackMap; onFeedback: (id: string, f: Feedback) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (items.length === 0) return <p className="detail">{NO_RECOMMENDATION}</p>
  return (
    <div>
      {items.map((p) => (
        <div className="rx" key={p.catalogId}>
          <div className="meta">
            <span className={p.grade === '핵심' ? 'grade-high' : 'grade-low'}>{p.grade}</span>
            <b>{p.name}</b>
            <span>{p.category}</span>
          </div>
          <p><b>왜</b> {p.why}</p>
          <p><b>무엇</b> {p.what}</p>
          <p><b>어떻게</b> {p.how}</p>
          <p className="detail">{p.caveat}</p>
          <p>
            <button onClick={() => setOpen((o) => ({ ...o, [p.catalogId]: !o[p.catalogId] }))}>왜?</button>
            {FB.map(([f, label]) => (
              <button key={f} className={feedback[p.catalogId] === f ? 'on' : ''} onClick={() => onFeedback(p.catalogId, f)}>{label}</button>
            ))}
          </p>
          {open[p.catalogId] && <ul className="detail">{p.signalsUsed.map((s) => <li key={s}>{s}</li>)}</ul>}
        </div>
      ))}
    </div>
  )
}
