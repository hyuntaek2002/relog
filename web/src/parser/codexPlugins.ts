// Codex 설치 플러그인: Codex 앱이 ChatGPT 계정으로 설치한 플러그인은 .codex/plugins/cache/openai-curated-remote/<이름>/<버전>/ 에 내려받아진다.
// zip 안의 경로 이름만 보고 파일 내용은 열지 않는다. config.toml의 [plugins] 항목은 설정 화면 목록과 맞지 않아 쓰지 않는다(2026-11-17 실제 화면과 대조).
// ponytail: 시스템 기본 플러그인(설정 화면 플러그인 탭에 안 보임)을 이름으로 뺀다. Codex가 기본 플러그인을 늘리면 여기에 추가할 것.
const SYSTEM = new Set(['plugin-management', 'work-pets', 'visualize'])

export function codexPluginFromPath(path: string): string | null {
  const m = /(?:^|\/)cache\/openai-curated-remote\/([^/]+)\//.exec(path.replace(/\\/g, '/'))
  return m && !SYSTEM.has(m[1]) ? m[1] : null
}
