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
}
export type PluginPlatform = 'chatgpt' | 'claude'

const TP = catalog.taskPlugins as { minMessages: number; howTo: string; items: TaskPluginEntry[]; codingSubPlugins: Partial<Record<CodingSub, PluginPick>> }
const CAND = candidates as { chatgptHowTo: string; chatgptInfo: Record<string, { id: string; oneLiner: string }>; chatgpt: Record<SnapshotTask, string[]> }
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

export function resolveTaskPlugins(snapshot: Pick<UsageSnapshot, 'taskCounts' | 'taskShare'>, minMessages = TP.minMessages, platform: PluginPlatform = 'claude'): TaskPluginRow[] {
  const howTo = platform === 'claude' ? TP.howTo : CAND.chatgptHowTo
  return itemsFor(platform)
    .map((e): TaskPluginRow => {
      const count = snapshot.taskCounts[e.task] ?? 0
      const share = snapshot.taskShare[e.task] ?? 0
      const status: TaskPluginRow['status'] = !e.pick ? 'none' : count < minMessages ? 'insufficient' : 'recommend'
      return { task: e.task, count, share, status, pick: e.pick, alt: e.alt, how: howTo.replace(/\{plugin\}/g, e.pick?.name ?? '') }
    })
    .sort((a, b) => b.count - a.count)
}
