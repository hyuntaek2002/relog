import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { TASK_LABELS, TASK_TYPES, type TaskType } from '../classify/classifier'
import type { Utterance } from '../parser/normalize'
import type { Conversation } from '../parser/types'

// 개발용 라벨링 화면. 원문은 이 화면에만 표시되고, 저장·내보내기는 messageId와 유형뿐이다.
// AI 제안(eval/labels/*.suggested.csv)이 있으면 그 답을 표시한다: 맞으면 Enter, 아니면 숫자키로 고친다.
// 내보내는 CSV는 사람이 확정한 라벨이다. 제안을 보고 확인한 라벨이라는 점은 보고할 때 밝혀야 한다.
type Label = TaskType | 'other' | 'context_required'
const EXTRA: [Label, string, string][] = [['other', '기타', '0'], ['context_required', '문맥 필요', 'c']]
const KEY = 'relog-labels-v1'
const NAME: Record<string, string> = { ...TASK_LABELS, other: '기타', context_required: '문맥 필요' }
// 한 줄 기준(eval/labels/README.md 요약). 버튼에 마우스를 올리거나 제안 옆에서 보인다.
const HINT: Record<string, string> = {
  coding: '코드를 짜거나 고치거나 설명해 달라, 명령어·오류 해결',
  writing: '글을 써 달라, 다듬어 달라, 요약·제목·감상문·창작',
  learning: '개념이나 이유를 설명해 달라, 문제 풀이, 공부',
  work_doc: '업무용 문서: 보고서·계획서·확약서·사과문·메일',
  search: '사실·수치·추천을 알려 달라(답이 설명보다 정보)',
  ideation: '아이디어·계획·일정·전략을 짜 달라',
  translation: '번역, 외국어 표현이 맞는지·무슨 뜻인지',
  chat: '고민·감정·잡담·인사, AI의 생각을 묻기',
  other: '어디에도 안 맞음: 역할극 설정, 그림 요청, 요청 없이 붙여 넣은 글',
  context_required: '너무 짧아서 이것만 봐서는 무엇을 원하는지 모름',
}

const load = (): Record<string, Label> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } }
// 저장소의 제안 파일을 필요할 때만 불러온다(개발 패널에서만 쓰임)
const SUGGEST_FILES = import.meta.glob('../../../eval/labels/*.suggested.csv', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const parseCsv = (text: string): Record<string, Label> => {
  const out: Record<string, Label> = {}
  for (const line of text.split('\n').slice(1)) { const [, messageId, type] = line.trim().split(','); if (messageId && type) out[messageId] = type as Label }
  return out
}

export default function Labeler({ utterances, conversations }: { utterances: Utterance[]; conversations: Conversation[] }) {
  const items = useMemo(() => utterances.filter((u) => u.status !== 'skipped'), [utterances])
  const convById = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations])
  const [labels, setLabels] = useState<Record<string, Label>>(load)
  const [suggest, setSuggest] = useState<Record<string, Label>>({})
  const [i, setI] = useState(() => Math.max(0, items.findIndex((u) => !load()[u.messageId])))

  useEffect(() => {
    let alive = true
    Promise.all(Object.values(SUGGEST_FILES).map((f) => f())).then((texts) => { if (alive) setSuggest(Object.assign({}, ...texts.map(parseCsv))) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const cur = items[i]
  const conv = cur && convById.get(cur.conversationId)
  // 직전 사용자 발화(문맥). 라벨 기준: 직전 발화까지만 참고.
  const prev = conv && [...conv.turns].reverse().find((t) => t.role === 'user' && t.idx < cur.idx)
  const hint = cur ? suggest[cur.messageId] : undefined

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
    if (e.key === 'Enter' && hint) { e.preventDefault(); set(hint) } // AI 제안 그대로 확정
    else if (e.key !== ' ' && n >= 1 && n <= TASK_TYPES.length) set(TASK_TYPES[n - 1])
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
    const next = { ...labels, ...parseCsv(await file.text()) }
    setLabels(next)
    localStorage.setItem(KEY, JSON.stringify(next))
  }

  if (!cur) return <p>라벨링할 발화가 없음</p>
  const labeled = items.filter((u) => labels[u.messageId])
  const done = labeled.length
  const withHint = items.filter((u) => suggest[u.messageId]).length
  const same = labeled.filter((u) => suggest[u.messageId] && suggest[u.messageId] === labels[u.messageId]).length
  const btn = (l: Label, text: string) => (
    <button key={l} title={HINT[l]} className={(labels[cur.messageId] === l ? 'on' : '') + (hint === l ? ' suggest' : '')} onClick={() => set(l)}>{text}</button>
  )
  return (
    <div className="labeler" tabIndex={0} onKeyDown={onKey}>
      <p className="detail">
        {i + 1} / {items.length} · 라벨 {done}개{withHint > 0 && ` · AI 제안과 같게 찍은 것 ${same}개`} · 이 영역을 클릭한 뒤 {withHint > 0 ? 'Enter(제안대로), ' : ''}숫자키 1~8, 0 기타, c 문맥 필요, ←→ 이동
        <button onClick={exportCsv}>CSV 내보내기</button>
        <label className="btn">CSV 불러오기<input type="file" accept=".csv" onChange={(e) => importCsv(e.target.files?.[0])} /></label>
      </p>
      <p className="detail">{conv?.title || '(제목 없음)'} · 발화 #{cur.idx}{cur.status === 'context_required' && ' · 자동판정: 문맥 필요'}</p>
      {prev && <blockquote className="prev">{prev.text.slice(0, 300)}</blockquote>}
      <blockquote className="cur">{cur.text}</blockquote>
      {hint && <p className="suggest-line">AI 제안: <b>{NAME[hint]}</b> <span className="detail">— {HINT[hint]}. 맞으면 Enter, 아니면 아래에서 고르세요.</span></p>}
      <div className="choices">
        {TASK_TYPES.map((t, k) => btn(t, `${k + 1} ${TASK_LABELS[t]}`))}
        {EXTRA.map(([l, name, key]) => btn(l, `${key} ${name}`))}
      </div>
    </div>
  )
}
