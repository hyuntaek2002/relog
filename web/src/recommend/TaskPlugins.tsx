import { useState } from 'react'
import { codingSubPlugin, isInstalled, resolveTaskPlugins, TASK_PLUGIN_MIN_MESSAGES, type PluginPick, type PluginPlatform, type TaskPluginRow } from './taskPluginRules'
import { CODING_SUB_LABEL, type CodingSub } from '../classify/codingSub'
import type { SnapshotTask, UsageSnapshot } from './snapshot'

// 대화 종류별 플러그인 카드. 많이 쓴 종류 순. 카드 = 종류·메시지 수 → 플러그인 이름 + 한 줄 / 데이터 부족 / 맞는 플러그인 없음.
// 코딩 카드에는 세부(웹 화면·서버 등) 수와, 세부가 기준을 넘으면 그 세부용 플러그인을 덧붙인다.
const TASK: Record<SnapshotTask, string> = { coding: '코딩', writing: '글쓰기·교정', learning: '학습·설명', workdoc: '업무 문서', search: '정보 탐색', ideation: '아이디어·기획', translation: '번역', counseling: '상담·대화' }
const steps = (how: string) => how.split(/\s*\d\)\s*/).map((s) => s.trim()).filter(Boolean)

function Pick({ p, how, alt, installed }: { p: PluginPick; how: string; alt?: PluginPick | null; installed: string[] }) {
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
      {p.evidenceUrl.startsWith('https://chatgpt.com/plugins/') && <p className="detail"><a href={p.evidenceUrl} target="_blank" rel="noreferrer">디렉터리에서 보기</a></p>}
      {have
        ? <p className="detail">대화 첫 메시지에 '{p.name} 플러그인 써서'라고 적으면 됩니다.</p>
        : <button className="link" onClick={() => setOpen((o) => !o)}>{open ? '닫기' : '설치 방법'}</button>}
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

function Card({ r, codingSub, installed }: { r: TaskPluginRow; codingSub: Partial<Record<CodingSub, number>>; installed: string[] }) {
  const subs = r.task === 'coding' ? (Object.entries(codingSub) as [CodingSub, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) : []
  const subPicks = subs.map(([s, n]) => [s, n, codingSubPlugin(s, n)] as const).filter(([, , sp]) => sp)
  return (
    <article className={'tp' + (r.status === 'recommend' ? '' : ' muted')}>
      <header className="meta"><b>{TASK[r.task]}</b><span>메시지 {r.count}개 · {Math.round(r.share * 100)}%</span></header>
      {r.status === 'none' && <p className="tp-line">맞는 플러그인이 아직 없습니다.</p>}
      {r.status === 'insufficient' && <p className="tp-line">메시지 {TASK_PLUGIN_MIN_MESSAGES}개 미만이라 아직 추천하지 않습니다.</p>}
      {r.status === 'recommend' && <Pick p={r.pick!} how={r.how} alt={r.alt} installed={installed} />}
      {subs.length > 0 && <p className="detail">세부: {subs.map(([s, n]) => `${CODING_SUB_LABEL[s]} ${n}`).join(' · ')}</p>}
      {subPicks.map(([s, n, sp]) => (
        <div key={s} className="tp-sub">
          <p className="detail">{CODING_SUB_LABEL[s]} {n}개 →</p>
          <Pick p={sp!.pick} how={sp!.how} installed={installed} />
        </div>
      ))}
    </article>
  )
}

export default function TaskPlugins({ snapshot, installed = [], platform = 'claude' }: { snapshot: UsageSnapshot; installed?: string[]; platform?: PluginPlatform }) {
  const rows = resolveTaskPlugins(snapshot, TASK_PLUGIN_MIN_MESSAGES, platform)
  return (
    <div>
      {installed.length > 0 && <p className="detail">설치됨: {installed.join(' · ')}</p>}
      <div className="tp-grid">{rows.map((r) => <Card key={r.task} r={r} codingSub={snapshot.codingSub ?? {}} installed={installed} />)}</div>
    </div>
  )
}
