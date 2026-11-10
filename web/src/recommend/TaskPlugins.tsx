import { useState } from 'react'
import { resolveTaskPlugins, TASK_PLUGIN_MIN_MESSAGES, type TaskPluginRow } from './taskPluginRules'
import type { SnapshotTask, UsageSnapshot } from './snapshot'

// 대화 종류별 플러그인 표. 많이 쓴 종류 순. 각 줄: 종류·메시지 수 → 플러그인 한 줄 / 데이터 부족 / 맞는 플러그인 없음.
const TASK: Record<SnapshotTask, string> = { coding: '코딩', writing: '글쓰기·교정', learning: '학습·설명', workdoc: '업무 문서', search: '정보 탐색', ideation: '아이디어·기획', translation: '번역', counseling: '상담·대화' }
const steps = (how: string) => how.split(/\s*\d\)\s*/).map((s) => s.trim()).filter(Boolean)

function Row({ r }: { r: TaskPluginRow }) {
  const [open, setOpen] = useState(false)
  const head = <><b>{TASK[r.task]}</b> <span className="detail">메시지 {r.count}개 ({Math.round(r.share * 100)}%)</span></>
  if (r.status === 'none') return <li>{head} — 맞는 플러그인이 아직 없습니다.</li>
  if (r.status === 'insufficient') return <li>{head} — 메시지가 {TASK_PLUGIN_MIN_MESSAGES}개 미만이라 아직 추천하지 않습니다.</li>
  const p = r.pick!
  return (
    <li>
      {head} → <b>{p.name}</b>{p.maker === 'Anthropic' && <> <span className="tag">Anthropic</span></>} {p.oneLiner}
      <button className="link" onClick={() => setOpen((o) => !o)}>{open ? '닫기' : '설치 방법'}</button>
      {open && (
        <div className="detail">
          <ol className="rx-steps">{steps(r.how).map((s, i) => <li key={i}>{s}</li>)}</ol>
          {r.alt && <p>대신 쓸 수 있는 것: <b>{r.alt.name}</b> {r.alt.oneLiner}</p>}
          {p.installs && <p>탐색 탭 설치 수 {p.installs} (2026-11-10 기준)</p>}
        </div>
      )}
    </li>
  )
}

export default function TaskPlugins({ snapshot }: { snapshot: UsageSnapshot }) {
  const rows = resolveTaskPlugins(snapshot)
  return (
    <div>
      <p className="detail">많이 쓴 대화 종류 순입니다. 그 종류 메시지가 {TASK_PLUGIN_MIN_MESSAGES}개 이상일 때만 플러그인을 권합니다. 효과는 아직 검증되지 않았습니다.</p>
      <ul className="task-plugins">{rows.map((r) => <Row key={r.task} r={r} />)}</ul>
    </div>
  )
}
