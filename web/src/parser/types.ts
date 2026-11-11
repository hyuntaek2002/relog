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
  client?: 'app' | 'code' // 없으면 앱(웹·데스크톱) 내보내기. 'code'는 Claude Code 세션 기록
  title: string
  createdAt: number | null
  turns: Turn[]
  toolNames: string[] // 대화 안에서 호출된 도구·연동 이름(본문 없는 메시지 포함). 기능 사용 자동 감지용
  pluginNames?: string[] // Claude Code 세션에서 확인된 설치 플러그인 id(스킬 목록·Skill 호출 접두어). 앱 내보내기에는 없음
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
