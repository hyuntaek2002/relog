import { useState } from 'react'
import { CATALOG, NO_RECOMMENDATION, type Feedback, type FeedbackMap, type Prescription } from './recommend'
import { isInstalled } from './taskPluginRules'
import { RepeatLine } from '../store/History'
import type { RepeatNote } from '../store/records'
import type { Mark, Marks } from '../store/marks'

// 추천 카드 0~3개: 한 줄 요약 → 무엇을 → 이렇게 하세요(번호) → 작은 주의. 근거 숫자는 펼침. 피드백은 로컬 저장.
export const FEEDBACK_KEY = 'relog-feedback-v1'
export const loadFeedback = (): FeedbackMap => { try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? '{}') } catch { return {} } }
export const saveFeedback = (f: FeedbackMap) => { try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(f)) } catch { /* 무시 */ } }

// 피드백은 다음 추천 점수에 반영: 도움됨 +1, 아님 −2
const FB: [Feedback, string, string][] = [['helpful', '도움됨', '다음 추천에서 이 항목 점수를 올립니다'], ['not_helpful', '아님', '다음 추천에서 이 항목 점수를 내립니다']]
const CATEGORY: Record<string, string> = { feature: '기능', plugin: '플러그인', connector: '연결', skill: '스킬', practice: '습관' }

// "1) … 2) … 3) …" 형식의 30초 사용법을 단계 배열로
export const steps = (how: string) => how.split(/\s*\d\)\s*/).map((s) => s.trim()).filter(Boolean)

// 쓰고 있음 / 쓰고 있지 않음: 지금 내가 그 항목을 쓰는지 직접 표시한다. 다시 누르면 표시를 지운다.
export function MarkButtons({ mark, onMark }: { mark?: Mark; onMark: (m: Mark) => void }) {
  return (
    <>
      <button className={mark === 'using' ? 'on' : ''} title="지금 쓰고 있으면 눌러 주세요. 기록에 남고, 습관·기능 추천에서는 빠집니다." onClick={() => onMark('using')}>{mark === 'using' ? '쓰고 있음 ✓' : '쓰고 있음'}</button>
      <button className={mark === 'not_using' ? 'on' : ''} title="지금 쓰지 않으면 눌러 주세요. 기록에 남고 추천은 그대로 둡니다." onClick={() => onMark('not_using')}>{mark === 'not_using' ? '쓰고 있지 않음 ✓' : '쓰고 있지 않음'}</button>
    </>
  )
}

export default function Prescriptions({ items, feedback, onFeedback, installed = [], notes = {}, marks = {}, onMark }: { items: Prescription[]; feedback: FeedbackMap; onFeedback: (id: string, f: Feedback) => void; installed?: string[]; notes?: Record<string, RepeatNote>; marks?: Marks; onMark?: (key: string, m: Mark) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // 쓰고 있다고 표시해 추천에서 빠진 습관·기능(되돌릴 수 있게 아래에 모아 둔다)
  const usingRx = CATALOG.filter((c) => marks[c.id] === 'using' && !items.some((p) => p.catalogId === c.id))
  return (
    <>
      {items.length === 0 && <p className="detail">{NO_RECOMMENDATION}</p>}
      <div className="rx-grid">
        {items.map((p) => (
          <article className="rx" key={p.catalogId}>
            <header className="meta">
              <b>{p.name}</b>
              {(CATEGORY[p.category] ?? p.category) !== p.name && <span className="tag">{CATEGORY[p.category] ?? p.category}</span>}
              <span className={p.grade === '핵심' ? 'grade-high' : 'grade-low'}>{p.grade === '핵심' ? '지금 필요' : '참고'}</span>
              {p.pluginName && isInstalled(p.pluginName, installed) && <span className="tag have">{p.pluginName} 이미 설치됨</span>}
            </header>
            <p className="lead">{p.summary} {p.what}</p>
            <RepeatLine note={notes[p.catalogId]} />
            <p className="steps-title">이렇게 하세요</p>
            <ol className="rx-steps">
              {steps(p.how).map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <p className="actions">
              {onMark && <MarkButtons mark={marks[p.catalogId]} onMark={(m) => onMark(p.catalogId, m)} />}
              {FB.map(([f, label, tip]) => (
                <button key={f} title={tip} className={feedback[p.catalogId] === f ? 'on' : ''} onClick={() => onFeedback(p.catalogId, f)}>{label}</button>
              ))}
              <button className="link" onClick={() => setOpen((o) => ({ ...o, [p.catalogId]: !o[p.catalogId] }))}>{open[p.catalogId] ? '근거 닫기' : '왜 이걸 추천하나요?'}</button>
            </p>
            {open[p.catalogId] && (
              <div className="detail">
                <p>{p.why}</p>
                <p>{p.caveat}</p>
                <ul>{p.signalsUsed.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            )}
          </article>
        ))}
      </div>
      {onMark && usingRx.length > 0 && (
        <p className="detail">쓰고 있다고 표시해 추천에서 뺀 것: {usingRx.map((c) => (
          <span key={c.id} className="using-item">{c.name} <button className="link" onClick={() => onMark(c.id, 'using')}>되돌리기</button></span>
        ))}</p>
      )}
    </>
  )
}
