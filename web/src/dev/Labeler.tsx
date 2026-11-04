import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { TASK_LABELS, TASK_TYPES, type TaskType } from '../classify/classifier'
import type { Utterance } from '../parser/normalize'
import type { Conversation } from '../parser/types'

// 개발용 라벨링 화면. 원문은 이 화면에만 표시되고, 저장·내보내기는 messageId와 유형뿐이다.
type Label = TaskType | 'other' | 'context_required'
const EXTRA: [Label, string, string][] = [['other', '기타', '0'], ['context_required', '문맥 필요', 'c']]
const KEY = 'relog-labels-v1'

const load = (): Record<string, Label> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } }

export default function Labeler({ utterances, conversations }: { utterances: Utterance[]; conversations: Conversation[] }) {
  const items = useMemo(() => utterances.filter((u) => u.status !== 'skipped'), [utterances])
  const convById = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations])
  const [labels, setLabels] = useState<Record<string, Label>>(load)
  const [i, setI] = useState(() => Math.max(0, items.findIndex((u) => !load()[u.messageId])))

  const cur = items[i]
  const conv = cur && convById.get(cur.conversationId)
  // 직전 사용자 발화(문맥). 라벨 기준: 직전 발화까지만 참고.
  const prev = conv && [...conv.turns].reverse().find((t) => t.role === 'user' && t.idx < cur.idx)

  function set(l: Label) {
    if (!cur) return
    const next = { ...labels, [cur.messageId]: l }
    setLabels(next)
    localStorage.setItem(KEY, JSON.stringify(next))
    setI((x) => Math.min(x + 1, items.length - 1))
  }

  // 단축키는 이 영역에 포커스가 있을 때만(반복 쌍 라벨링과 숫자키가 겹치므로)
  function onKey(e: ReactKeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return
    const n = Number(e.key)
    if (n >= 1 && n <= TASK_TYPES.length) set(TASK_TYPES[n - 1])
    else if (e.key === '0') set('other')
    else if (e.key === 'c') set('context_required')
    else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    else if (e.key === 'ArrowRight') setI((x) => Math.min(items.length - 1, x + 1))
  }

  function exportCsv() {
    const rows = items.filter((u) => labels[u.messageId]).map((u) => `${u.conversationId},${u.messageId},${labels[u.messageId]}`)
    const blob = new Blob(['conversationId,messageId,type\n' + rows.join('\n') + '\n'], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'labels.csv' })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importCsv(file: File | undefined) {
    if (!file) return
    const next = { ...labels }
    for (const line of (await file.text()).split('\n').slice(1)) {
      const [, messageId, type] = line.trim().split(',')
      if (messageId && type) next[messageId] = type as Label
    }
    setLabels(next)
    localStorage.setItem(KEY, JSON.stringify(next))
  }

  if (!cur) return <p>라벨링할 발화가 없음</p>
  const done = items.filter((u) => labels[u.messageId]).length
  return (
    <div className="labeler" tabIndex={0} onKeyDown={onKey}>
      <p className="detail">
        {i + 1} / {items.length} · 라벨 {done}개 · 이 영역을 클릭한 뒤 숫자키 1~8, 0 기타, c 문맥 필요, ←→ 이동
        <button onClick={exportCsv}>CSV 내보내기</button>
        <label className="btn">CSV 불러오기<input type="file" accept=".csv" onChange={(e) => importCsv(e.target.files?.[0])} /></label>
      </p>
      <p className="detail">{conv?.title || '(제목 없음)'} · 발화 #{cur.idx}{cur.status === 'context_required' && ' · 자동판정: 문맥 필요'}</p>
      {prev && <blockquote className="prev">{prev.text.slice(0, 300)}</blockquote>}
      <blockquote className="cur">{cur.text}</blockquote>
      <div className="choices">
        {TASK_TYPES.map((t, k) => (
          <button key={t} className={labels[cur.messageId] === t ? 'on' : ''} onClick={() => set(t)}>{k + 1} {TASK_LABELS[t]}</button>
        ))}
        {EXTRA.map(([l, name, key]) => (
          <button key={l} className={labels[cur.messageId] === l ? 'on' : ''} onClick={() => set(l)}>{key} {name}</button>
        ))}
      </div>
    </div>
  )
}
