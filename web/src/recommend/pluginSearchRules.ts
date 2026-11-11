// 플러그인 찾기 데이터 형식과 검색 규칙(화면 없이 Node 테스트에서도 쓰므로 .ts로 분리)
export interface PluginEntry { n: string; s: string; r: string; c: string[]; i: number | null; a: boolean; k?: string } // 이름·영문 요약·저장소·카테고리 slug·설치 수·Anthropic 작성·한국어 한 줄
export interface PluginFile { format: string; fetchedAt: string; note: string; categories: Record<string, string>; plugins: PluginEntry[] }
export const PLUGIN_FILE = 'plugins-2026-11-10.json'
export const PLUGIN_FORMAT = 'relog-plugins-1'

// 검색어는 공백으로 나눈 모든 조각이 이름·요약·한국어 설명 중 어딘가에 들어 있어야 한다. 카테고리는 slug 하나로 거른다.
export function filterPlugins(list: PluginEntry[], q: string, cat: string): PluginEntry[] {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean)
  return list.filter((p) => (!cat || p.c.includes(cat)) && toks.every((t) => `${p.n} ${p.s} ${p.k ?? ''}`.toLowerCase().includes(t)))
}
export const fmtInstalls = (n: number | null) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(n))
