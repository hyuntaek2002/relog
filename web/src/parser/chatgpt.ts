import { parseClaudeConversation, type RawClaudeConversation } from './claude.ts'
import type { Conversation, ParseError, ParseResult, Turn } from './types.ts'

export const PARSER_VERSION = 'export-0.3.0' // 0.3.0: Claude Code 세션(.jsonl) 지원, zip 여러 개 병합

// 상대 비교용 근사치. 한글 1자 ≈ 1.5, 그 외 4자 ≈ 1 토큰.
export function estimateTokens(text: string): number {
  let hangul = 0
  for (const ch of text) if (ch >= '가' && ch <= '힣') hangul++
  return Math.round(hangul * 1.5 + (text.length - hangul) / 4)
}

// 내보내기 JSON의 느슨한 형태. 필드 누락을 전제로 전부 optional.
interface RawMessage {
  id?: string
  author?: { role?: string }
  create_time?: number | null
  content?: { content_type?: string; parts?: unknown[]; text?: string; language?: string }
  metadata?: { is_visually_hidden_from_conversation?: boolean; attachments?: unknown[] }
  recipient?: string
}
interface RawNode { id?: string; message?: RawMessage | null; parent?: string | null; children?: string[] }
interface RawConversation {
  id?: string
  conversation_id?: string
  title?: string
  create_time?: number | null
  mapping?: Record<string, RawNode>
  current_node?: string
}

// content_type별로 본문 추출. 이미지 등 비텍스트 파트는 건너뛴다.
function messageText(m: RawMessage): string {
  const c = m.content
  if (!c) return ''
  if (c.content_type === 'code') return '```' + (c.language ?? '') + '\n' + (c.text ?? '') + '\n```'
  if (Array.isArray(c.parts)) return c.parts.filter((p): p is string => typeof p === 'string').join('\n').trim()
  return typeof c.text === 'string' ? c.text.trim() : ''
}

// current_node에서 parent를 따라 루트까지 올라가 활성 경로만 선형화한다.
function activePath(mapping: Record<string, RawNode>, current: string): RawNode[] {
  const path: RawNode[] = []
  const seen = new Set<string>()
  let id: string | null | undefined = current
  while (id && mapping[id] && !seen.has(id)) {
    seen.add(id)
    path.push(mapping[id])
    id = mapping[id].parent
  }
  return path.reverse()
}

export function parseConversation(raw: RawConversation): Conversation {
  const id = raw.conversation_id ?? raw.id
  if (!id) throw new Error('id 누락')
  if (!raw.mapping || typeof raw.mapping !== 'object') throw new Error('mapping 누락')
  if (!raw.current_node || !raw.mapping[raw.current_node]) throw new Error('current_node 누락 또는 mapping에 없음')

  const turns: Turn[] = []
  for (const node of activePath(raw.mapping, raw.current_node)) {
    const m = node.message
    if (!m) continue
    const role = m.author?.role
    if (role !== 'user' && role !== 'assistant') continue
    if (m.metadata?.is_visually_hidden_from_conversation) continue
    if (m.recipient && m.recipient !== 'all') continue // 도구 호출 등
    const text = messageText(m)
    if (!text) continue
    turns.push({
      idx: turns.length,
      role,
      text,
      createdAt: m.create_time ? Math.round(m.create_time * 1000) : null,
      messageId: m.id ?? node.id ?? `${id}:${turns.length}`,
      tokenEstimate: estimateTokens(text),
      hasAttachment: (m.metadata?.attachments?.length ?? 0) > 0 || (Array.isArray(m.content?.parts) && m.content!.parts!.some((p) => typeof p !== 'string')),
    })
  }
  return {
    id,
    platform: 'chatgpt',
    title: raw.title ?? '',
    createdAt: raw.create_time ? Math.round(raw.create_time * 1000) : null,
    turns,
    toolNames: [], // ChatGPT 내보내기의 도구 흔적은 실제 파일 확인 후 추가
  }
}

// conversations.json 하나(배열)를 파싱. 항목마다 ChatGPT(mapping)/Claude(chat_messages) 형식을 판별한다. 대화 단위 오류는 기록 후 건너뛴다.
export function parseConversationsJson(json: unknown): ParseResult {
  const conversations: Conversation[] = []
  const errors: ParseError[] = []
  if (!Array.isArray(json)) return { parserVersion: PARSER_VERSION, conversations, errors: [{ conversationId: null, reason: '최상위가 배열이 아님' }] }
  for (const raw of json as (RawConversation & RawClaudeConversation)[]) {
    try {
      conversations.push('chat_messages' in raw ? parseClaudeConversation(raw) : parseConversation(raw))
    } catch (e) {
      errors.push({ conversationId: raw?.conversation_id ?? raw?.id ?? raw?.uuid ?? null, reason: (e as Error).message })
    }
  }
  return { parserVersion: PARSER_VERSION, conversations, errors }
}
