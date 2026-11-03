import type { Prediction } from '../classify/classifier.ts'
import type { Candidate, DetectSummary } from '../detect/detector.ts'
import type { Utterance } from '../parser/normalize.ts'
import type { BasicStats } from '../parser/stats.ts'

// 추천 엔진 입력. 원문 없음. 집계 숫자만.
export type SnapshotTask = 'coding' | 'writing' | 'learning' | 'workdoc' | 'search' | 'ideation' | 'translation' | 'counseling'
export const SNAPSHOT_TASKS: SnapshotTask[] = ['coding', 'writing', 'learning', 'workdoc', 'search', 'ideation', 'translation', 'counseling']

export interface UsageSnapshot {
  platform: 'chatgpt' | 'claude'
  taskShare: Record<SnapshotTask, number>
  taskCounts: Record<SnapshotTask, number>
  userTurnCount: number
  conversationCount: number
  longConversationShare: number
  avgTurnsPerConversation: number
  codeShare: number
  hourHistogram: number[]
  restatement: {
    high: number
    mid: number
    low: number
    misunderstanding: number
    repeatedQuestion: number
    perTask: Partial<Record<SnapshotTask, number>>
    tokenEstimate: number
    ratio: number
  }
}

// 내부 분류 키 → 스냅샷 키
const TASK_MAP: Record<string, SnapshotTask> = { coding: 'coding', writing: 'writing', learning: 'learning', work_doc: 'workdoc', search: 'search', ideation: 'ideation', translation: 'translation', chat: 'counseling' }

export function buildSnapshot(args: {
  platform: 'chatgpt' | 'claude'
  stats: BasicStats
  utterances: Utterance[] // 전체(상태 무관)
  okIds: string[] // 분류에 쓰인 ok 발화의 messageId, preds와 같은 순서
  preds: Prediction[]
  candidates: Candidate[]
  detect: DetectSummary
}): UsageSnapshot {
  const { platform, stats, utterances, okIds, preds, candidates, detect } = args
  const taskCounts = Object.fromEntries(SNAPSHOT_TASKS.map((t) => [t, 0])) as Record<SnapshotTask, number>
  const typeById = new Map<string, SnapshotTask>()
  preds.forEach((p, i) => {
    const t = TASK_MAP[p.type]
    if (t) { taskCounts[t]++; typeById.set(okIds[i], t) }
  })
  const classified = Object.values(taskCounts).reduce((a, b) => a + b, 0)
  const taskShare = Object.fromEntries(SNAPSHOT_TASKS.map((t) => [t, classified ? taskCounts[t] / classified : 0])) as Record<SnapshotTask, number>

  const hourHistogram = new Array<number>(24).fill(0)
  let ok = 0, withCode = 0
  for (const u of utterances) {
    if (u.createdAt != null) hourHistogram[new Date(u.createdAt).getHours()]++
    if (u.status === 'ok') { ok++; if (u.hasCode) withCode++ }
  }

  const perTask: Partial<Record<SnapshotTask, number>> = {}
  for (const c of candidates) {
    if (!c.grade) continue
    const t = typeById.get(c.messageId)
    if (t) perTask[t] = (perTask[t] ?? 0) + 1
  }
  // 대화 수는 사용자 발화가 있는 대화만(본문 없는 대화 제외)
  const convsWithTurns = new Set(utterances.map((u) => u.conversationId)).size
  return {
    platform,
    taskShare,
    taskCounts,
    userTurnCount: stats.userTurns,
    conversationCount: convsWithTurns,
    longConversationShare: convsWithTurns ? stats.longConversations / convsWithTurns : 0,
    avgTurnsPerConversation: convsWithTurns ? stats.userTurns / convsWithTurns : 0,
    codeShare: ok ? withCode / ok : 0,
    hourHistogram,
    restatement: {
      high: detect.byGrade.high,
      mid: detect.byGrade.medium,
      low: detect.byGrade.low,
      misunderstanding: detect.misunderstanding,
      repeatedQuestion: detect.repeatedQuestions,
      perTask,
      tokenEstimate: detect.tokenEstimate,
      ratio: detect.ratio,
    },
  }
}
