import type { Conversation } from './types.ts'

export interface BasicStats {
  conversations: number
  userTurns: number
  assistantTurns: number
  longConversations: number // 사용자 발화 10개 이상
  judgeableUserTurns: number // 사용자 발화 2개 이상인 대화의 사용자 발화 수 (R의 분모)
  userTokenEstimate: number
}

export function basicStats(convs: Conversation[]): BasicStats {
  const s: BasicStats = { conversations: convs.length, userTurns: 0, assistantTurns: 0, longConversations: 0, judgeableUserTurns: 0, userTokenEstimate: 0 }
  for (const c of convs) {
    let u = 0
    for (const t of c.turns) {
      if (t.role === 'user') { u++; s.userTokenEstimate += t.tokenEstimate } else s.assistantTurns++
    }
    s.userTurns += u
    if (u >= 10) s.longConversations++
    if (u >= 2) s.judgeableUserTurns += u
  }
  return s
}
