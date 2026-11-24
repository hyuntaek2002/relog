import catalog from '../../../catalog/catalog.json' with { type: 'json' }
import candidates from '../../../catalog/plugin-candidates.json' with { type: 'json' }
import { SNAPSHOT_TASKS, type SnapshotTask, type UsageSnapshot } from './snapshot.ts'
import type { CodingSub } from '../classify/codingSub'
import type { Conversation } from '../parser/types'

// 대화 종류별 플러그인: 그 종류의 내 메시지가 기준(minMessages) 이상이면 플러그인을 권하고,
// 모자라면 "데이터 부족", 맞는 플러그인이 없는 종류(상담·대화)는 "맞는 플러그인 없음"으로 표시한다.
// Claude는 catalog.json taskPlugins, ChatGPT는 plugin-candidates.json의 종류별 첫 후보(chatgpt.com/plugins 디렉터리, 2026-11-12 확인).
export interface PluginPick { name: string; kind: 'plugin' | 'connector'; maker: string; installs: string | null; oneLiner: string; evidenceUrl: string }
export interface TaskPluginEntry { task: SnapshotTask; pick: PluginPick | null; alt: PluginPick | null; evidenceNote: string }
export interface TaskPluginRow {
  task: SnapshotTask
  count: number
  share: number
  status: 'recommend' | 'insufficient' | 'none'
  pick: PluginPick | null
  alt: PluginPick | null
  how: string // {plugin} 치환 완료
  ranked: PoolPlugin[] // 그 종류 후보 전체. 내 대화와 비슷한 순(비교값이 없으면 사람이 정한 순). 화면은 앞 3개, 나머지는 전체 목록
  popular: PoolPlugin[] // 설치 수 많은 순(Claude만, 설치 수가 있는 후보만)
  bySimilarity: boolean // ranked가 내 대화와 비교한 순서인지
}
// 후보 하나: 이름·한 줄(한국어 우선)·임베딩할 설명·설치 수(Claude 탐색 탭 2026-11-10 기준)·보러 갈 주소
export interface PoolPlugin { name: string; line: string; text: string; installs: number | null; url: string; score?: number }
export type PluginPlatform = 'chatgpt' | 'claude'

const TP = catalog.taskPlugins as { minMessages: number; howTo: string; items: TaskPluginEntry[]; codingSubPlugins: Partial<Record<CodingSub, PluginPick>> }
type Info = { oneLiner: string; summary: string }
const CAND = candidates as unknown as {
  chatgptHowTo: string
  chatgptInfo: Record<string, Info & { id: string }>
  claudeInfo: Record<string, Info & { installs: number | null; repo: string; category: string }>
  chatgpt: Record<SnapshotTask, string[]>
  claude: Record<SnapshotTask, string[]>
}
// 코딩 세부(게임·웹 화면 등)별 플러그인. 그 세부 메시지가 기준 이상일 때만 쓴다.
// 기록에서 확인된 설치 플러그인(Claude Code 세션의 스킬 목록·Skill 호출 접두어). 앱 내보내기만 있으면 빈 배열
export const installedPlugins = (convs: Pick<Conversation, 'pluginNames'>[]): string[] => [...new Set(convs.flatMap((c) => c.pluginNames ?? []))].sort()
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
// 디렉터리 표시 이름("UI Design Review", "Caveman Mode: Short Answers")과 플러그인 id("engineering", "caveman")를 느슨하게 맞춘다
// ponytail: 접두어 일치. 이름이 전혀 다른 플러그인(예: 표시 이름 Superpowers / id superpowers-dev)은 못 맞추면 '이미 씀' 버튼으로
export const isInstalled = (name: string, installed: string[]) => installed.some((p) => { const a = norm(name), b = norm(p); return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a)) })

export const codingSubPlugin = (sub: CodingSub, count: number): { pick: PluginPick; how: string } | null => {
  const p = TP.codingSubPlugins[sub]
  return p && count >= TP.minMessages ? { pick: p, how: TP.howTo.split('{plugin}').join(p.name) } : null
}
export const TASK_PLUGIN_MIN_MESSAGES = TP.minMessages

// ChatGPT 후보 이름 → 카드 정보(한국어 한 줄, 디렉터리 링크)
const cgPick = (name: string): PluginPick => ({ name, kind: 'plugin', maker: '', installs: null, oneLiner: CAND.chatgptInfo[name]?.oneLiner ?? '', evidenceUrl: `https://chatgpt.com/plugins/${CAND.chatgptInfo[name]?.id ?? ''}` })
const itemsFor = (platform: PluginPlatform): TaskPluginEntry[] =>
  platform === 'claude' ? TP.items : SNAPSHOT_TASKS.map((task) => { const n = CAND.chatgpt[task]?.[0]; return { task, pick: n ? cgPick(n) : null, alt: null, evidenceNote: '' } })

// 대화 종류별 후보(plugin-candidates.json pcand-0.3.0). Claude 첫 후보의 한 줄은 catalog taskPlugins의 손으로 쓴 문구를 쓴다
export function pluginPool(platform: PluginPlatform, task: SnapshotTask): PoolPlugin[] {
  const hand = platform === 'claude' ? TP.items.find((e) => e.task === task) : undefined
  return (CAND[platform][task] ?? []).map((name) => {
    if (platform === 'chatgpt') {
      const i = CAND.chatgptInfo[name]
      return { name, line: i?.oneLiner || i?.summary || '', text: `${name}: ${i?.summary ?? ''} ${i?.oneLiner ?? ''}`, installs: null, url: `https://chatgpt.com/plugins/${i?.id ?? ''}` }
    }
    const i = CAND.claudeInfo[name]
    const line = [hand?.pick, hand?.alt].find((p) => p?.name === name)?.oneLiner || i?.oneLiner || i?.summary || ''
    return { name, line, text: `${name}: ${i?.summary ?? ''} ${i?.oneLiner ?? ''}`, installs: i?.installs ?? null, url: i?.repo || (i?.category ? `https://claude.ai/new#customize/plugins/${i.category}` : '') }
  })
}

/** 임베딩할 후보 목록(플랫폼의 모든 종류, 이름 중복 없이). 워커에 설명을 보내고 같은 순서로 벡터를 받는다 */
export function poolTexts(platform: PluginPlatform): { names: string[]; texts: string[] } {
  const seen = new Map<string, string>()
  for (const t of SNAPSHOT_TASKS) for (const p of pluginPool(platform, t)) if (!seen.has(p.name)) seen.set(p.name, p.text)
  return { names: [...seen.keys()], texts: [...seen.values()] }
}

/**
 * 종류별로 후보가 내 대화와 얼마나 가까운지: (그 종류 내 메시지 평균과의 코사인) − (내 메시지 전체 평균과의 코사인).
 * 전체 평균을 빼서 '어느 대화에나 비슷하게 가까운' 일반적인 후보가 위로 오는 것을 줄인다. 벡터는 모두 브라우저 안에서만 쓴다.
 * types[i]는 i번째 메시지의 스냅샷 종류 키(없으면 null). 벡터는 정규화돼 있다고 본다.
 * ponytail: 평균 벡터 하나로 비교. 한 종류 안에 성격이 다른 대화가 섞이면 무뎌짐, 필요하면 대화별 최댓값으로.
 */
export function similarityScores(emb: Float32Array, dim: number, types: (SnapshotTask | null)[], pluginVecs: Float32Array, names: string[]): Partial<Record<SnapshotTask, Record<string, number>>> {
  const mean = (idx: number[]) => {
    const m = new Float32Array(dim)
    for (const i of idx) for (let d = 0; d < dim; d++) m[d] += emb[i * dim + d]
    let n = 0
    for (let d = 0; d < dim; d++) n += m[d] * m[d]
    n = Math.sqrt(n) || 1
    return m.map((x) => x / n)
  }
  const dot = (a: Float32Array, j: number) => { let s = 0; for (let d = 0; d < dim; d++) s += a[d] * pluginVecs[j * dim + d]; return s }
  const all = mean(types.map((_, i) => i))
  const base = names.map((_, j) => dot(all, j))
  const out: Partial<Record<SnapshotTask, Record<string, number>>> = {}
  for (const t of SNAPSHOT_TASKS) {
    const idx = types.flatMap((x, i) => (x === t ? [i] : []))
    if (!idx.length) continue
    const m = mean(idx)
    out[t] = Object.fromEntries(names.map((n, j) => [n, dot(m, j) - base[j]]))
  }
  return out
}

export function resolveTaskPlugins(snapshot: Pick<UsageSnapshot, 'taskCounts' | 'taskShare'>, minMessages = TP.minMessages, platform: PluginPlatform = 'claude', scores: Partial<Record<SnapshotTask, Record<string, number>>> = {}): TaskPluginRow[] {
  const howTo = platform === 'claude' ? TP.howTo : CAND.chatgptHowTo
  return itemsFor(platform)
    .map((e): TaskPluginRow => {
      const count = snapshot.taskCounts[e.task] ?? 0
      const share = snapshot.taskShare[e.task] ?? 0
      const status: TaskPluginRow['status'] = !e.pick ? 'none' : count < minMessages ? 'insufficient' : 'recommend'
      // 메시지가 기준 이상일 때만 내 대화와 비교한 순서를 쓴다(적으면 평균이 흔들림)
      const sc = status === 'recommend' ? scores[e.task] : undefined
      const pool = pluginPool(platform, e.task).map((p) => ({ ...p, score: sc?.[p.name] }))
      const ranked = sc ? [...pool].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) : pool
      const popular = pool.filter((p) => p.installs != null).sort((a, b) => b.installs! - a.installs!)
      return { task: e.task, count, share, status, pick: e.pick, alt: e.alt, how: howTo.replace(/\{plugin\}/g, e.pick?.name ?? ''), ranked, popular, bySimilarity: !!sc }
    })
    .sort((a, b) => b.count - a.count)
}
