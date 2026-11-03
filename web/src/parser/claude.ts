import { estimateTokens } from './chatgpt.ts'
import type { Conversation, Turn } from './types.ts'

// Claude 내보내기(conversations.json). chat_messages는 시간순 배열이지만 편집·재생성 분기가 섞여 있다
// (실측: 44개 중 3개 대화에 형제 메시지 존재). 마지막 메시지에서 parent_message_uuid를 따라 올라간 경로만 활성.
interface RawClaudeMessage {
  uuid?: string
  parent_message_uuid?: string
  sender?: string
  text?: string
  content?: { type?: string; text?: string }[]
  created_at?: string
  attachments?: unknown[]
  files?: unknown[]
}
export interface RawClaudeConversation {
  uuid?: string
  name?: string
  created_at?: string
  chat_messages?: RawClaudeMessage[]
}

const toMs = (iso?: string) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? null : t
}

function messageText(m: RawClaudeMessage): string {
  if (Array.isArray(m.content)) {
    const t = m.content.filter((c) => c.type === 'text' && typeof c.text === 'string').map((c) => c.text!.trim()).filter(Boolean).join('\n')
    if (t) return t
  }
  return typeof m.text === 'string' ? m.text.trim() : ''
}

export function parseClaudeConversation(raw: RawClaudeConversation): Conversation {
  if (!raw.uuid) throw new Error('uuid 누락')
  if (!Array.isArray(raw.chat_messages)) throw new Error('chat_messages 누락')
  const byId = new Map(raw.chat_messages.filter((m) => m.uuid).map((m) => [m.uuid!, m]))
  const path: RawClaudeMessage[] = []
  const seen = new Set<string>()
  let cur: RawClaudeMessage | undefined = raw.chat_messages.at(-1)
  while (cur && cur.uuid && !seen.has(cur.uuid)) {
    seen.add(cur.uuid)
    path.push(cur)
    cur = cur.parent_message_uuid ? byId.get(cur.parent_message_uuid) : undefined
  }
  path.reverse()
  // parent_message_uuid가 없어 트리를 못 만드는 파일이면 배열 순서 그대로 사용
  const messages = raw.chat_messages.some((m) => m.parent_message_uuid) ? path : raw.chat_messages

  const turns: Turn[] = []
  for (const m of messages) {
    const role = m.sender === 'human' ? 'user' : m.sender === 'assistant' ? 'assistant' : null
    if (!role) continue
    const text = messageText(m)
    if (!text) continue
    turns.push({ idx: turns.length, role, text, createdAt: toMs(m.created_at), messageId: m.uuid ?? `${raw.uuid}:${turns.length}`, tokenEstimate: estimateTokens(text), hasAttachment: (m.attachments?.length ?? 0) > 0 || (m.files?.length ?? 0) > 0 || (m.content?.some((c) => c.type === 'image' || c.type === 'document') ?? false) })
  }
  return { id: raw.uuid, platform: 'claude', title: raw.name ?? '', createdAt: toMs(raw.created_at), turns }
}
