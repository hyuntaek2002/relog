import { useState } from 'react'
import { codingSubPlugin, isInstalled, resolveTaskPlugins, TASK_PLUGIN_MIN_MESSAGES, type PluginPick, type PluginPlatform, type TaskPluginRow } from './taskPluginRules'
import { CODING_SUB_LABEL, type CodingSub } from '../classify/codingSub'
import type { SnapshotTask, UsageSnapshot } from './snapshot'
import { RepeatLine } from '../store/History'
import { promptKey, type RepeatNote } from '../store/records'
import { AppliedButton } from './Prescriptions'
import { starterPrompt } from './starterPrompts'

// 대화 종류별 플러그인 카드. 많이 쓴 종류 순. 카드 = 종류·메시지 수 → 플러그인 이름 + 한 줄 / 데이터 부족 / 맞는 플러그인 없음.
// 코딩 카드에는 세부(웹 화면·서버 등) 수와, 세부가 기준을 넘으면 그 세부용 플러그인을 덧붙인다.
const TASK: Record<SnapshotTask, string> = { coding: '코딩', writing: '글쓰기·교정', learning: '학습·설명', workdoc: '업무 문서', search: '정보 탐색', ideation: '아이디어·기획', translation: '번역', counseling: '상담·대화' }
const steps = (how: string) => how.split(/\s*\d\)\s*/).map((s) => s.trim()).filter(Boolean)

type Applied = { applied: string[]; onApplied?: (key: string) => void }

function Pick({ p, how, alt, installed, note, applied, onApplied }: { p: PluginPick; how: string; alt?: PluginPick | null; installed: string[]; note?: RepeatNote } & Applied) {
  const [open, setOpen] = useState(false)
  const have = isInstalled(p.name, installed)
  return (
    <div className="tp-pick">
      <p className="tp-name">
        <b>{p.name}</b>
        {have && <span className="tag have">이미 설치됨</span>}
        {/Anthropic/.test(p.maker) && <span className="tag">{p.maker}</span>}
      </p>
      <p className="tp-line">{p.oneLiner}</p>
      <RepeatLine note={note} />
      {p.evidenceUrl.startsWith('https://chatgpt.com/plugins/') && <p className="detail"><a href={p.evidenceUrl} target="_blank" rel="noreferrer">디렉터리에서 보기</a></p>}
      <p className="actions">
        {onApplied && <AppliedButton on={applied.includes(p.name)} onToggle={() => onApplied(p.name)} />}
        {have
          ? <span className="detail">대화 첫 메시지에 '{p.name} 플러그인 써서'라고 적으면 됩니다.</span>
          : <button className="link" onClick={() => setOpen((o) => !o)}>{open ? '닫기' : '설치 방법'}</button>}
      </p>
      {open && !have && (
        <div className="detail">
          <ol className="rx-steps">{steps(how).map((s, i) => <li key={i}>{s}</li>)}</ol>
          {alt && <p>대신 쓸 수 있는 것: <b>{alt.name}</b> {alt.oneLiner}</p>}
          {p.installs && <p>탐색 탭 설치 수 {p.installs} (2026-11-10 기준)</p>}
        </div>
      )}
    </div>
  )
}

// 새 채팅 시작 문구: 복사해서 그 종류의 새 대화 첫 메시지로 붙여 넣는다. 설치한 플러그인이 있으면 이름을 넣는다.
function Starter({ task, plugin, note, applied, onApplied }: { task: SnapshotTask; plugin?: string; note?: RepeatNote } & Applied) {
  const [copied, setCopied] = useState(false)
  const text = starterPrompt(task, plugin)
  const key = promptKey(task)
  return (
    <details className="tp-starter">
      <summary>새 {TASK[task]} 채팅 시작 문구</summary>
      <pre>{text}</pre>
      <RepeatLine note={note} />
      <p className="actions">
        <button onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => {})}>{copied ? '복사했습니다' : '복사'}</button>
        {onApplied && <AppliedButton on={applied.includes(key)} onToggle={() => onApplied(key)} />}
      </p>
      <p className="detail">[ ] 안을 채워 새 채팅의 첫 메시지로 보내세요. 매번 붙여 넣기 번거로우면 Claude 프로젝트 지침이나 ChatGPT 맞춤 지침(프로젝트 지침)에 한 번 넣어 두어도 됩니다.</p>
    </details>
  )
}

function Card({ r, codingSub, installed, platform, notes, applied, onApplied }: { r: TaskPluginRow; codingSub: Partial<Record<CodingSub, number>>; installed: string[]; platform: PluginPlatform; notes: Record<string, RepeatNote> } & Applied) {
  const subs = r.task === 'coding' ? (Object.entries(codingSub) as [CodingSub, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) : []
  // 세부 유형 플러그인 후보는 Claude 디렉터리 것뿐이라 ChatGPT에서는 세부 숫자만 보인다
  const subPicks = platform === 'claude' ? subs.map(([s, n]) => [s, n, codingSubPlugin(s, n)] as const).filter(([, , sp]) => sp) : []
  return (
    <article className="tp">
      <header className="meta"><b>{TASK[r.task]}</b><span>메시지 {r.count}개 · {Math.round(r.share * 100)}%</span></header>
      {r.status === 'none' && <p className="tp-line">이 종류에 맞는 플러그인은 아직 없습니다. 아래 시작 문구만 써 보세요.</p>}
      {r.pick && <Pick p={r.pick} how={r.how} alt={r.alt} installed={installed} note={notes[r.pick.name]} applied={applied} onApplied={onApplied} />}
      {r.status === 'insufficient' && <p className="detail">이 종류 메시지가 {r.count}개({TASK_PLUGIN_MIN_MESSAGES}개 미만)라 내 기록 근거는 약합니다. 이 종류 대화를 할 때 참고하세요.</p>}
      {subs.length > 0 && <p className="detail">세부: {subs.map(([s, n]) => `${CODING_SUB_LABEL[s]} ${n}`).join(' · ')}</p>}
      {subPicks.map(([s, n, sp]) => (
        <div key={s} className="tp-sub">
          <p className="detail">{CODING_SUB_LABEL[s]} {n}개 →</p>
          <Pick p={sp!.pick} how={sp!.how} installed={installed} applied={applied} onApplied={onApplied} />
        </div>
      ))}
      <Starter task={r.task} plugin={r.pick && isInstalled(r.pick.name, installed) ? r.pick.name : undefined} note={notes[promptKey(r.task)]} applied={applied} onApplied={onApplied} />
    </article>
  )
}

export default function TaskPlugins({ snapshot, installed = [], platform = 'claude', notes = {}, applied = [], onApplied }: { snapshot: UsageSnapshot; installed?: string[]; platform?: PluginPlatform; notes?: Record<string, RepeatNote>; applied?: string[]; onApplied?: (key: string) => void }) {
  const rows = resolveTaskPlugins(snapshot, TASK_PLUGIN_MIN_MESSAGES, platform)
  return (
    <div>
      {installed.length > 0 && <p className="detail">설치됨: {installed.join(' · ')}</p>}
      <div className="tp-grid">{rows.map((r) => <Card key={r.task} r={r} codingSub={snapshot.codingSub ?? {}} installed={installed} platform={platform} notes={notes} applied={applied} onApplied={onApplied} />)}</div>
    </div>
  )
}
