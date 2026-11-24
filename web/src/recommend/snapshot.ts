import type { Prediction } from '../classify/classifier.ts'
import type { CodingSub } from '../classify/codingSub.ts'
import type { Utterance } from '../parser/normalize.ts'
import type { BasicStats } from '../parser/stats.ts'

// 추천 엔진 입력. 원문 없음. 집계 숫자만.
// cls-0.5.0부터 6가지(업무 문서는 글·문서, 정보 탐색은 정보·학습에 합침)
export type SnapshotTask = 'coding' | 'writing' | 'learning' | 'ideation' | 'translation' | 'counseling'
export const SNAPSHOT_TASKS: SnapshotTask[] = ['coding', 'writing', 'learning', 'ideation', 'translation', 'counseling']
export const SNAPSHOT_LABEL: Record<SnapshotTask, string> = { coding: '코딩', writing: '글·문서', learning: '정보·학습', ideation: '아이디어·기획', translation: '번역', counseling: '상담·대화' }

export interface UsageSnapshot {
  platform: 'chatgpt' | 'claude'
  taskShare: Record<SnapshotTask, number>
  taskCounts: Record<SnapshotTask, number>
  userTurnCount: number
  conversationCount: number
  longConversationShare: number
  avgTurnsPerConversation: number
  codeShare: number
  codingSub: Partial<Record<CodingSub, number>> // 코딩으로 분류된 내 메시지의 세부(대화 단위 판정) 수
  answer: { avgTokens: number; ratio: number } // AI 답변 평균 분량(토큰 추정)과 내 메시지 분량 대비 배수
  hourHistogram: number[]
}

// 분류 키 → 스냅샷 키(work_doc·search는 예전 기록용)
export const TASK_MAP: Record<string, SnapshotTask> = { coding: 'coding', writing: 'writing', learning: 'learning', ideation: 'ideation', translation: 'translation', chat: 'counseling', work_doc: 'writing', search: 'learning' }

export function buildSnapshot(args: {
  platform: 'chatgpt' | 'claude'
  stats: BasicStats
  utterances: Utterance[] // 전체(상태 무관)
  okIds: string[] // 분류에 쓰인 ok 발화의 messageId, preds와 같은 순서
  preds: Prediction[]
  subByConversation?: Record<string, CodingSub>
}): UsageSnapshot {
  const { platform, stats, utterances, okIds, preds, subByConversation = {} } = args
  const convById = new Map(utterances.map((u) => [u.messageId, u.conversationId]))
  const codingSub: Partial<Record<CodingSub, number>> = {}
  const taskCounts = Object.fromEntries(SNAPSHOT_TASKS.map((t) => [t, 0])) as Record<SnapshotTask, number>
  preds.forEach((p, i) => {
    const t = TASK_MAP[p.type]
    if (t) taskCounts[t]++
    if (t === 'coding') { const s = subByConversation[convById.get(okIds[i]) ?? ''] ?? 'other'; codingSub[s] = (codingSub[s] ?? 0) + 1 }
  })
  const classified = Object.values(taskCounts).reduce((a, b) => a + b, 0)
  const taskShare = Object.fromEntries(SNAPSHOT_TASKS.map((t) => [t, classified ? taskCounts[t] / classified : 0])) as Record<SnapshotTask, number>

  const hourHistogram = new Array<number>(24).fill(0)
  let ok = 0, withCode = 0
  for (const u of utterances) {
    if (u.createdAt != null) hourHistogram[new Date(u.createdAt).getHours()]++
    if (u.status === 'ok') { ok++; if (u.hasCode) withCode++ }
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
    codingSub,
    answer: { avgTokens: stats.assistantTurns ? stats.assistantTokenEstimate / stats.assistantTurns : 0, ratio: stats.userTokenEstimate ? stats.assistantTokenEstimate / stats.userTokenEstimate : 0 },
    hourHistogram,
  }
}
