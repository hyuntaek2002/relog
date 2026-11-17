// ChatGPT·Codex 플러그인 디렉터리(chatgpt.com/plugins 공개 화면, 로그인 없음)에서 모은 원자료 → 화면 검색용 정적 파일.
// 사용: node eval/recommend/build_chatgpt_plugins.mjs <원자료 json> <수집일 YYYY-MM-DD>
// 원자료 형식: { [pluginId]: { name, desc, cats: [[slug, 순위], ...] } } (디렉터리 표시 순서)
import fs from 'node:fs'

const [raw, date] = process.argv.slice(2)
if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) { console.error('사용: build_chatgpt_plugins.mjs <원자료 json> <YYYY-MM-DD>'); process.exit(1) }
const src = JSON.parse(fs.readFileSync(raw, 'utf8'))
const cand = JSON.parse(fs.readFileSync(new URL('../../catalog/plugin-candidates.json', import.meta.url), 'utf8'))
const koById = Object.fromEntries(Object.values(cand.chatgptInfo).map((v) => [v.id, v.oneLiner]))

const CATEGORIES = {
  featured: '추천', 'new-and-noteworthy': '새로 나온', productivity: '생산성', 'developer-tools': '개발 도구', communication: '커뮤니케이션',
  'business-and-operations': '비즈니스·운영', 'small-business': '소규모 비즈니스', creativity: '창작', finance: '금융', healthcare: '건강',
  'education-and-research': '교육·연구', 'scientific-research': '과학 연구', travel: '여행', 'data-and-analytics': '데이터·분석', security: '보안', other: '기타',
}
const plugins = Object.entries(src).map(([id, p]) => {
  const c = (p.cats ?? []).map(([s]) => s)
  for (const s of c) if (!CATEGORIES[s]) throw new Error(`모르는 카테고리 ${s}`)
  return { id, n: p.name, s: p.desc, r: '', c, i: null, a: false, ...(koById[id] ? { k: koById[id] } : {}) }
})
const out = {
  format: 'relog-plugins-1', fetchedAt: date,
  note: 'ChatGPT·Codex 공용 플러그인 디렉터리(chatgpt.com/plugins) 공개 화면 기준. 순서는 디렉터리 표시 순서, 설치 수는 공개되지 않음.',
  categories: CATEGORIES, plugins,
}
const file = new URL(`../../web/public/chatgpt-plugins-${date}.json`, import.meta.url)
fs.writeFileSync(file, JSON.stringify(out))
console.log(plugins.length, '개 →', file.pathname, (fs.statSync(file).size / 1024).toFixed(0) + 'KB', '한국어', plugins.filter((p) => p.k).length)
