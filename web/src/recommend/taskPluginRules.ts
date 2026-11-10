import catalog from '../../../catalog/catalog.json' with { type: 'json' }
import type { SnapshotTask, UsageSnapshot } from './snapshot'
import type { CodingSub } from '../classify/codingSub'

// 대화 종류별 플러그인: 그 종류의 내 메시지가 기준(minMessages) 이상이면 카탈로그에 적힌 플러그인을 권하고,
// 모자라면 "데이터 부족", 맞는 플러그인이 없는 종류(상담·대화)는 "맞는 플러그인 없음"으로 표시한다.
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

const TP = catalog.taskPlugins as { minMessages: number; howTo: string; items: TaskPluginEntry[]; codingSubPlugins: Partial<Record<CodingSub, PluginPick>> }
// 코딩 세부(게임·웹 화면 등)별 플러그인. 그 세부 메시지가 기준 이상일 때만 쓴다.
export const codingSubPlugin = (sub: CodingSub, count: number): { pick: PluginPick; how: string } | null => {
  const p = TP.codingSubPlugins[sub]
  return p && count >= TP.minMessages ? { pick: p, how: TP.howTo.split('{plugin}').join(p.name) } : null
}
export const TASK_PLUGIN_MIN_MESSAGES = TP.minMessages

export function resolveTaskPlugins(snapshot: Pick<UsageSnapshot, 'taskCounts' | 'taskShare'>, minMessages = TP.minMessages): TaskPluginRow[] {
  return TP.items
    .map((e): TaskPluginRow => {
      const count = snapshot.taskCounts[e.task] ?? 0
      const share = snapshot.taskShare[e.task] ?? 0
      const status: TaskPluginRow['status'] = !e.pick ? 'none' : count < minMessages ? 'insufficient' : 'recommend'
      return { task: e.task, count, share, status, pick: e.pick, alt: e.alt, how: TP.howTo.replace(/\{plugin\}/g, e.pick?.name ?? '') }
    })
    .sort((a, b) => b.count - a.count)
}
