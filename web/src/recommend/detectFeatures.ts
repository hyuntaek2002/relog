import type { Conversation } from '../parser/types.ts'

// 대화 파일의 도구 호출 이름으로 "이미 쓰는 기능"을 추정한다. 사용자에게 묻지 않는다.
// 보이지 않는 기능(Claude 메모리·프로젝트 지침·과거 대화 검색 등)은 파일에 흔적이 없어 감지 불가 → 처방 카드의 "이미 씀"으로만.
// ChatGPT는 도구 메시지가 내보내기에 없어 대화 속성(프로젝트·메모리 설정·음성·플러그인·편집 분기)으로 감지한다.
export const FEATURE_DETECTOR_VERSION = 'featdet-0.2.0' // 0.2.0: ChatGPT 대화 속성(프로젝트·메모리·음성·플러그인·메시지 편집)

// [카탈로그 id, 도구 이름 패턴] — 실제 Claude 내보내기(2026-11-03)에서 관찰된 이름 기준
const RULES: [string, RegExp][] = [
  ['cl_web_search', /^(WebSearch|web_search|WebFetch|web_fetch)$/],
  ['cl_artifacts', /^mcp__claude-artifacts__/],
  ['cl_skills', /^Skill$/],
  ['cl_connectors_google', /^integration:Google|google_drive|^mcp__google/i],
  ['cl_research', /^(research|advanced_research)$/i],
  // ChatGPT: parser/chatgpt.ts featureTraces가 붙인 이름
  ['cg_projects', /^chatgpt:project$/],
  ['cg_memory', /^chatgpt:memory$/],
  ['cg_voice', /^chatgpt:voice$/],
  ['cg_plugins', /^chatgpt:plugins$/],
  ['cg_edit_message', /^chatgpt:edit$/],
]

export interface DetectedFeature { catalogId: string; conversations: number }

export function detectFeatures(convs: Conversation[]): DetectedFeature[] {
  const count = new Map<string, number>()
  for (const c of convs) {
    const hit = new Set<string>()
    if (c.client === 'code') hit.add('tool:claude_code') // Claude Code 기록을 같이 올렸으면 Claude Code 전용 항목을 추천 대상에 넣는다
    for (const name of c.toolNames) for (const [id, re] of RULES) if (re.test(name)) hit.add(id)
    for (const id of hit) count.set(id, (count.get(id) ?? 0) + 1)
  }
  return [...count].map(([catalogId, conversations]) => ({ catalogId, conversations })).sort((a, b) => b.conversations - a.conversations)
}
