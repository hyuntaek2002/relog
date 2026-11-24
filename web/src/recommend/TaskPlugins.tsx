import { useRef, useState } from 'react'
import { codingSubPlugin, isInstalled, TASK_PLUGIN_MIN_MESSAGES, type PluginPick, type PluginPlatform, type PoolPlugin, type TaskPluginRow } from './taskPluginRules'
import { CODING_SUB_LABEL, type CodingSub } from '../classify/codingSub'
import { SNAPSHOT_LABEL, type SnapshotTask, type UsageSnapshot } from './snapshot'
import { RepeatLine } from '../store/History'
import { promptKey, type RepeatNote } from '../store/records'
import type { Mark, Marks } from '../store/marks'
import { MarkButtons } from './Prescriptions'
import { starterPrompt } from './starterPrompts'
import { fmtInstalls } from './pluginSearchRules'

// 대화 종류별 플러그인 카드(2026-11-24): 종류마다 후보를 '내 대화와 비슷한 순' 1~3위로, Claude는 '설치 많은 순' 1~3위도 함께.
// 후보가 3개보다 적으면 있는 만큼만. 나머지 후보는 '전체 후보 보기' 창에서. 많이 쓴 종류 순.
const TASK = SNAPSHOT_LABEL
const steps = (how: string) => how.split(/\s*\d\)\s*/).map((s) => s.trim()).filter(Boolean)
const TOP = 3

type MarkProps = { marks: Marks; onMark?: (key: string, m: Mark) => void }

// 후보 한 줄: 순위 · 이름 · 태그 / 한 줄 설명 / 쓰고 있음·쓰고 있지 않음
function Row({ p, rank, installed, note, marks, onMark, showInstalls }: { p: PoolPlugin; rank?: number; installed: string[]; note?: RepeatNote; showInstalls?: boolean } & MarkProps) {
  const have = isInstalled(p.name, installed)
  return (
    <li className="tp-row">
      <p className="tp-name">
        {rank != null && <span className="rank">{rank}</span>}
        <b>{p.name}</b>
        {have && <span className="tag have">이미 설치됨</span>}
        {showInstalls && p.installs != null && <span className="detail">설치 {fmtInstalls(p.installs)}</span>}
        {p.url && <a href={p.url} target="_blank" rel="noreferrer">보기</a>}
      </p>
      {p.line && <p className="tp-line">{p.line}</p>}
      <RepeatLine note={note} />
      {onMark && <p className="actions"><MarkButtons mark={marks[p.name]} onMark={(m) => onMark(p.name, m)} /></p>}
    </li>
  )
}

// 코딩 세부(웹 화면·게임 등) 플러그인: 세부 메시지가 기준을 넘을 때만 하나씩
function SubPick({ p, installed, marks, onMark }: { p: PluginPick; installed: string[] } & MarkProps) {
  return <Row p={{ name: p.name, line: p.oneLiner, text: '', installs: null, url: p.evidenceUrl.startsWith('http') ? p.evidenceUrl : '' }} installed={installed} marks={marks} onMark={onMark} />
}

// 새 채팅 시작 문구: 복사해서 그 종류의 새 대화 첫 메시지로 붙여 넣는다. 설치한 플러그인이 있으면 이름을 넣는다.
function Starter({ task, plugin, note, marks, onMark }: { task: SnapshotTask; plugin?: string; note?: RepeatNote } & MarkProps) {
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
        {onMark && <MarkButtons mark={marks[key]} onMark={(m) => onMark(key, m)} />}
      </p>
      <p className="detail">[ ] 안을 채워 새 채팅의 첫 메시지로 보내세요. 매번 붙여 넣기 번거로우면 Claude 프로젝트 지침이나 ChatGPT 맞춤 지침(프로젝트 지침)에 한 번 넣어 두어도 됩니다.</p>
    </details>
  )
}

// 전체 후보 창: 그 종류 후보 전부(비슷한 순), 설치 수와 함께
function AllDialog({ r, installed, marks, onMark, platform }: { r: TaskPluginRow; installed: string[]; platform: PluginPlatform } & MarkProps) {
  const ref = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button className="link" onClick={() => ref.current?.showModal()}>전체 후보 {r.ranked.length}개 보기</button>
      <dialog ref={ref} className="tp-dialog" onClick={(e) => { if (e.target === ref.current) ref.current.close() }}>
        <header className="meta"><b>{TASK[r.task]} 플러그인 후보 {r.ranked.length}개</b><button onClick={() => ref.current?.close()}>닫기</button></header>
        <p className="detail">{r.bySimilarity ? '내 대화와 비슷한 순입니다.' : r.status === 'insufficient' ? '사람이 정한 순입니다(이 종류 메시지가 적어 내 대화와 비교하지 않았습니다).' : '사람이 정한 순입니다.'}{platform === 'claude' && ' 설치 수는 Claude 앱 탐색 탭 2026-11-10 기준입니다.'}</p>
        <ol className="tp-list">{r.ranked.map((p, i) => <Row key={p.name} p={p} rank={i + 1} installed={installed} marks={marks} onMark={onMark} showInstalls />)}</ol>
        <details className="detail">
          <summary>설치 방법</summary>
          <ol className="rx-steps">{steps(r.pick ? r.how.split(r.pick.name).join('플러그인 이름') : r.how).map((s, i) => <li key={i}>{s}</li>)}</ol>
        </details>
      </dialog>
    </>
  )
}

function Card({ r, codingSub, installed, platform, notes, marks, onMark }: { r: TaskPluginRow; codingSub: Partial<Record<CodingSub, number>>; installed: string[]; platform: PluginPlatform; notes: Record<string, RepeatNote> } & MarkProps) {
  const subs = r.task === 'coding' ? (Object.entries(codingSub) as [CodingSub, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) : []
  // 세부 유형 플러그인 후보는 Claude 디렉터리 것뿐이라 ChatGPT에서는 세부 숫자만 보인다
  const subPicks = platform === 'claude' ? subs.map(([s, n]) => [s, n, codingSubPlugin(s, n)] as const).filter(([, , sp]) => sp) : []
  const top = r.ranked.slice(0, TOP)
  const popular = r.popular.slice(0, TOP)
  const firstInstalled = top.find((p) => isInstalled(p.name, installed))?.name
  return (
    <article className="tp">
      <header className="meta"><b>{TASK[r.task]}</b><span>메시지 {r.count}개 · {Math.round(r.share * 100)}%</span></header>
      {r.status === 'none' && <p className="tp-line tp-none">이 종류에 맞는 플러그인은 아직 없습니다. 아래 시작 문구만 써 보세요.</p>}
      {top.length > 0 && (
        <div className="tp-sec">
          <p className="tp-label">{r.bySimilarity ? '내 대화와 비슷한 순' : '추천 순'}</p>
          <ol className="tp-list">{top.map((p, i) => <Row key={p.name} p={p} rank={i + 1} installed={installed} note={notes[p.name]} marks={marks} onMark={onMark} />)}</ol>
        </div>
      )}
      {popular.length > 0 && (
        <div className="tp-sec">
          <p className="tp-label">설치 많은 순</p>
          <ol className="tp-list">{popular.map((p, i) => <Row key={p.name} p={p} rank={i + 1} installed={installed} marks={marks} onMark={onMark} showInstalls />)}</ol>
        </div>
      )}
      {r.status === 'insufficient' && <p className="detail tp-weak">메시지 {r.count}개({TASK_PLUGIN_MIN_MESSAGES}개 미만)라 내 대화와 비교하지 않았습니다. 참고만 하세요.</p>}
      {r.ranked.length > TOP && <div className="actions"><AllDialog r={r} installed={installed} marks={marks} onMark={onMark} platform={platform} /></div>}
      {subs.length > 0 && (
        <div className="tp-sub">
          <p className="tp-label">세부: {subs.map(([s, n]) => `${CODING_SUB_LABEL[s]} ${n}개`).join(' · ')}{subPicks.length > 0 && ' → 맞는 플러그인'}</p>
          {subPicks.length > 0 && <ul className="tp-list">{subPicks.map(([s, , sp]) => <SubPick key={s} p={sp!.pick} installed={installed} marks={marks} onMark={onMark} />)}</ul>}
        </div>
      )}
      <Starter task={r.task} plugin={firstInstalled} note={notes[promptKey(r.task)]} marks={marks} onMark={onMark} />
    </article>
  )
}

export default function TaskPlugins({ rows, codingSub, installed = [], platform = 'claude', notes = {}, marks, onMark }: { rows: TaskPluginRow[]; codingSub: UsageSnapshot['codingSub']; installed?: string[]; platform?: PluginPlatform; notes?: Record<string, RepeatNote> } & MarkProps) {
  return (
    <div>
      {installed.length > 0 && <p className="detail">설치됨: {installed.join(' · ')}</p>}
      <div className="tp-grid">{rows.map((r) => <Card key={r.task} r={r} codingSub={codingSub ?? {}} installed={installed} platform={platform} notes={notes} marks={marks} onMark={onMark} />)}</div>
    </div>
  )
}
