// 공통 구조. 플랫폼별 파서는 모두 이 형태로 변환한다.
export interface Turn {
  idx: number
  role: 'user' | 'assistant'
  text: string
  createdAt: number | null // epoch ms
  messageId: string
  tokenEstimate: number
  hasAttachment: boolean // 첨부파일·이미지 등 텍스트 외 입력 동반
}

export interface Conversation {
  id: string
  platform: 'chatgpt' | 'claude'
  title: string
  createdAt: number | null
  turns: Turn[]
}

export interface ParseError {
  conversationId: string | null
  reason: string
}

export interface ParseResult {
  parserVersion: string
  conversations: Conversation[]
  errors: ParseError[]
}
