import { useState } from 'react'
import { codingSubPlugin, resolveTaskPlugins, TASK_PLUGIN_MIN_MESSAGES, type PluginPick, type TaskPluginRow } from './taskPluginRules'
import { CODING_SUB_LABEL, type CodingSub } from '../classify/codingSub'
import type { SnapshotTask, UsageSnapshot } from './snapshot'

// 대화 종류별 플러그인 표. 많이 쓴 종류 순. 각 줄: 종류·메시지 수 → 플러그인 한 줄 / 데이터 부족 / 맞는 플러그인 없음.
// 코딩 줄에는 세부(웹 화면·서버 등) 수와, 세부가 기준을 넘으면 그 세부용 플러그인을 덧붙인다.
const TASK: Record<SnapshotTask, string> = { coding: '코딩', writing: '글쓰기·교정', learning: '학습·설명', workdoc: '업무 문서', search: '정보 탐색', ideation: '아이디어·기획', translation: '번역', counseling: '상담·대화' }
const steps = (how: string) => how.split(/\s*\d\)\s*/).map((s) => s.trim()).filter(Boolean)

function Pick({ p, how, alt }: { p: PluginPick; how: string; alt?: PluginPick | null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <b>{p.name}</b>{/Anthropic/.test(p.maker) && <> <span className="tag">{p.maker}</span></>} {p.oneLiner}
      <button className="link" onClick={() => setOpen((o) => !o)}>{open ? '닫기' : '설치 방법'}</button>
      {open && (
        <div className="detail">
          <ol className="rx-steps">{steps(how).map((s, i) => <li key={i}>{s}</li>)}</ol>
          {alt && <p>대신 쓸 수 있는 것: <b>{alt.name}</b> {alt.oneLiner}</p>}
          {p.installs && <p>탐색 탭 설치 수 {p.installs} (2026-11-10 기준)</p>}
        </div>
      )}
    </>
  )
}

function Row({ r, codingSub }: { r: TaskPluginRow; codingSub: Partial<Record<CodingSub, number>> }) {
  const head = <><b>{TASK[r.task]}</b> <span className="detail">메시지 {r.count}개 ({Math.round(r.share * 100)}%)</span></>
  if (r.status === 'none') return <li>{head} — 맞는 플러그인이 아직 없습니다.</li>
  if (r.status === 'insufficient') return <li>{head} — 메시지가 {TASK_PLUGIN_MIN_MESSAGES}개 미만이라 아직 추천하지 않습니다.</li>
  const subs = r.task === 'coding' ? (Object.entries(codingSub) as [CodingSub, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) : []
  return (
    <li>
      {head} → <Pick p={r.pick!} how={r.how} alt={r.alt} />
      {subs.length > 0 && (
        <ul className="detail">
          <li>세부: {subs.map(([s, n]) => `${CODING_SUB_LABEL[s]} ${n}`).join(' · ')}</li>
          {subs.map(([s, n]) => { const sp = codingSubPlugin(s, n); return sp && <li key={s}>{CODING_SUB_LABEL[s]} {n}개 → <Pick p={sp.pick} how={sp.how} /></li> })}
        </ul>
      )}
    </li>
  )
}

export default function TaskPlugins({ snapshot }: { snapshot: UsageSnapshot }) {
  const rows = resolveTaskPlugins(snapshot)
  return (
    <div>
      <p className="detail">많이 쓴 대화 종류 순입니다. 그 종류 메시지가 {TASK_PLUGIN_MIN_MESSAGES}개 이상일 때만 플러그인을 권합니다. Claude Code 기록의 메시지는 모두 코딩으로 셉니다. 효과는 아직 검증되지 않았습니다.</p>
      <ul className="task-plugins">{rows.map((r) => <Row key={r.task} r={r} codingSub={snapshot.codingSub ?? {}} />)}</ul>
    </div>
  )
}
