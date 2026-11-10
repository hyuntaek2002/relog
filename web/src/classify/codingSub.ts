import type { Prediction } from './classifier'
import type { Conversation } from '../parser/types'
import type { Utterance } from '../parser/normalize'

// 코딩 세부 분류. 메시지 하나로는 판단이 안 되므로(“이거 고쳐”) 대화(세션) 단위로 정한다:
// 내 메시지·제목·도구 이름에서 키워드를 세어 가장 많은 쪽. 2개 미만이면 '기타'.
// ponytail: 키워드 규칙. 정답 라벨이 쌓이면 임베딩 분류로 바꾼다.
export type CodingSub = 'web' | 'server' | 'mobile' | 'game' | 'data' | 'infra' | 'other'
export const CODING_SUB_LABEL: Record<CodingSub, string> = { web: '웹 화면', server: '서버·API·DB', mobile: '모바일 앱', game: '게임', data: '데이터·AI', infra: '배포·인프라', other: '기타' }

// 영문은 단어 경계(\b)로, 한글은 \b가 안 먹으므로 그대로 부분 일치
const KW: [CodingSub, string[], string[]][] = [
  ['web', ['react', 'vue', 'svelte', 'next\\.?js', 'vite', 'tailwind', 'css', 'html', 'jsx', 'tsx', 'dom', 'frontend'], ['웹', '프런트', '프론트', '화면', '컴포넌트', '버튼', '레이아웃', '브라우저']],
  ['server', ['api', 'rest', 'graphql', 'spring', 'express', 'fastapi', 'django', 'flask', 'node\\.?js', 'jpa', 'sql', 'mysql', 'postgres', 'redis', 'jwt'], ['엔드포인트', '서버', '백엔드', '데이터베이스', '디비', '쿼리', '테이블', '마이그레이션', '컨트롤러']],
  ['mobile', ['android', 'ios', 'kotlin', 'swift', 'swiftui', 'flutter', 'react native', 'xcode', 'gradle'], ['앱스토어', '플레이스토어', '안드로이드', '아이폰', '모바일', '액티비티', '프래그먼트']],
  ['game', ['unity', 'unreal', 'godot', 'c#', 'monobehaviour', 'prefab', 'shader', 'sprite'], ['게임', '유니티', '프리팹', '스프라이트', '캐릭터', '스테이지']],
  ['data', ['pandas', 'numpy', 'pytorch', 'tensorflow', 'sklearn', 'embedding', 'dataset', 'csv', 'f1', 'llm', 'rag'], ['임베딩', '모델 학습', '학습 데이터', '데이터셋', '분류기', '정확도', '프롬프트']],
  ['infra', ['docker', 'kubernetes', 'k8s', 'github actions', 'deploy', 'nginx', 'aws', 'gcp', 'azure', 'vercel', 'ssl'], ['배포', '도메인', '인증서', '서버 설정', '환경 변수']],
]
const RULES: [CodingSub, RegExp][] = KW.map(([sub, en, ko]) => [sub, new RegExp(`\\b(?:${en.join('|')})\\b|(?:${ko.join('|')})`, 'gi')])

export function codingSubtype(conv: Pick<Conversation, 'title' | 'turns' | 'toolNames'>): CodingSub {
  const text = [conv.title, ...conv.turns.filter((t) => t.role === 'user').map((t) => t.text.slice(0, 2000)), ...conv.toolNames].join('\n')
  let best: CodingSub = 'other', bestN = 1
  for (const [sub, re] of RULES) {
    const n = (text.match(re) ?? []).length
    if (n > bestN) { best = sub; bestN = n }
  }
  return best
}

// Claude Code 세션(client:'code')의 메시지는 전부 코딩 작업 맥락이므로 자동 분류와 무관하게 '코딩'으로 고정한다.
// 실측(2026-11-10): 고정 전에는 Code 메시지 1,523개가 글쓰기·상담 등으로 흩어져 코딩이 21%에 그쳤다.
export function pinCodeToCoding(preds: Prediction[], okUtts: Utterance[], conversations: Pick<Conversation, 'id' | 'client'>[]): Prediction[] {
  const code = new Set(conversations.filter((c) => c.client === 'code').map((c) => c.id))
  return preds.map((p, i) => (code.has(okUtts[i]?.conversationId) ? { type: 'coding', score: 1 } : p))
}

export function subByConversation(conversations: Conversation[]): Record<string, CodingSub> {
  return Object.fromEntries(conversations.map((c) => [c.id, codingSubtype(c)]))
}
