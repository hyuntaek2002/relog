import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Candidate } from '../detect/detector'
import type { Utterance } from '../parser/normalize'
import type { Conversation } from '../parser/types'

// 개발용 반복 후보 쌍 라벨링. 유사도 상위 N쌍을 앞/뒤 발화와 함께 보여주고 정답을 찍는다.
// 저장·내보내기는 id와 라벨뿐. 원문은 이 화면에만 보인다.
type Label = 'repeat' | 'normal' | 'resend' | 'unsure'
const LABELS: [Label, string, string][] = [['repeat', '반복 지시', '1'], ['normal', '정상 후속', '2'], ['resend', '재전송/수정', '3'], ['unsure', '모름', '0']]
const KEY = 'relog-pair-labels-v1'
const TOP_N = 100

const NAME = Object.fromEntries(LABELS.map(([l, name]) => [l, name])) as Record<Label, string>

const load = (): Record<string, Label> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } }
// AI 제안(eval/labels/pair-suggested.csv, id와 답만). 맞으면 Enter, 아니면 숫자키로 고친다.
// 내보내는 CSV는 사람이 확정한 라벨이다. 제안을 보고 확인한 라벨이라는 점은 보고할 때 밝혀야 한다.
const SUGGEST_FILES = import.meta.glob('../../../eval/labels/pair-suggested.csv', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const parseCsv = (text: string): Record<string, Label> => {
  const out: Record<string, Label> = {}
  for (const line of text.split('\n').slice(1)) { const [, messageId, , , label] = line.trim().split(','); if (messageId && label in NAME) out[messageId] = label as Label }
  return out
}

export default function PairLabeler({ pairs, utterances, conversations }: { pairs: Candidate[]; utterances: Utterance[]; conversations: Conversation[] }) {
  // 지시형·질문형 가리지 않고 유사도 순. 탐지기 예측(grade)은 숨긴다.
  const items = useMemo(() => [...pairs].sort((a, b) => b.similarity - a.similarity).slice(0, TOP_N), [pairs])
  const textById = useMemo(() => new Map(utterances.map((u) => [u.messageId, u.text])), [utterances])
  const titleById = useMemo(() => new Map(conversations.map((c) => [c.id, c.title])), [conversations])
  const [labels, setLabels] = useState<Record<string, Label>>(load)
  const [i, setI] = useState(() => Math.max(0, items.findIndex((p) => !load()[p.messageId])))
  const [suggest, setSuggest] = useState<Record<string, Label>>({})
  useEffect(() => {
    let alive = true
    Promise.all(Object.values(SUGGEST_FILES).map((f) => f())).then((texts) => { if (alive) setSuggest(Object.assign({}, ...texts.map(parseCsv))) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const cur = items[i]
  const hint = cur ? suggest[cur.messageId] : undefined

  function set(l: Label) {
    if (!cur) return
    const next = { ...labels, [cur.messageId]: l }
    setLabels(next)
    localStorage.setItem(KEY, JSON.stringify(next))
    setI((x) => Math.min(x + 1, items.length - 1))
  }

  // 단축키는 이 영역에 포커스가 있을 때만(과업 라벨링과 숫자키가 겹치므로)
  function onKey(e: ReactKeyboardEvent) {
    const hit = LABELS.find(([, , k]) => k === e.key)
    if (e.key === 'Enter' && hint) { e.preventDefault(); set(hint) } // AI 제안 그대로 확정
    else if (hit) set(hit[0])
    else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    else if (e.key === 'ArrowRight') setI((x) => Math.min(items.length - 1, x + 1))
  }

  function exportCsv() {
    const rows = items.filter((p) => labels[p.messageId]).map((p) => `${p.conversationId},${p.messageId},${p.priorMessageId},${p.similarity.toFixed(4)},${labels[p.messageId]}`)
    const blob = new Blob(['conversationId,messageId,priorMessageId,similarity,label\n' + rows.join('\n') + '\n'], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'pair-labels.csv' })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!cur) return <p className="detail">라벨링할 쌍이 없음</p>
  const labeled = items.filter((p) => labels[p.messageId])
  const done = labeled.length
  const withHint = items.filter((p) => suggest[p.messageId]).length
  const same = labeled.filter((p) => suggest[p.messageId] === labels[p.messageId]).length
  return (
    <div className="labeler" tabIndex={0} onKeyDown={onKey}>
      <p className="detail">
        {i + 1} / {items.length} · 라벨 {done}개{withHint > 0 && ` · AI 제안과 같게 찍은 것 ${same}개`} · 이 영역을 클릭한 뒤 {withHint > 0 ? 'Enter(제안대로), ' : ''}1 반복 지시, 2 정상 후속, 3 재전송/수정, 0 모름, ←→ 이동
        <button onClick={exportCsv}>CSV 내보내기</button>
      </p>
      <p className="detail">{titleById.get(cur.conversationId) || '(제목 없음)'} · 비슷한 정도 {cur.similarity.toFixed(2)} · {cur.gapMinutes != null ? (cur.gapMinutes < 60 ? `${Math.round(cur.gapMinutes)}분 뒤` : `${Math.round(cur.gapMinutes / 60)}시간 뒤`) : '시각 없음'}{cur.responseBetween ? '' : ' · 사이에 응답 없음'}</p>
      <blockquote className="prev">{(textById.get(cur.priorMessageId) ?? '').slice(0, 600)}</blockquote>
      <blockquote className="cur">{(textById.get(cur.messageId) ?? '').slice(0, 600)}</blockquote>
      {hint && <p className="suggest-line">AI 제안: <b>{NAME[hint]}</b> <span className="detail">— 맞으면 Enter, 아니면 아래에서 고르세요.</span></p>}
      <div className="choices">
        {LABELS.map(([l, name, k]) => (
          <button key={l} className={(labels[cur.messageId] === l ? 'on' : '') + (hint === l ? ' suggest' : '')} onClick={() => set(l)}>{k} {name}</button>
        ))}
      </div>
      <p className="detail">기준: 앞 메시지에서 이미 말한 지시·정보를 다시 말했으면 '반복 지시'. 새 요구·같은 주제의 다른 요청이면 '정상 후속'. 몇 분 안에 거의 같은 글을 다시 보냈으면 '재전송/수정'.</p>
    </div>
  )
}
