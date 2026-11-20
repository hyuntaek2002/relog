// Claude 플러그인 목록 갱신과 추천 후보 점검.
//  1) Claude Code 공식 마켓플레이스(공개 GitHub anthropics/claude-plugins-official)를 받아 sources/claude-code-marketplace.json에 둔다.
//  2) --local-cache를 주면 이 PC의 Claude Code가 받아 두는 디렉터리 캐시(~/.claude/plugins/plugin-directory-cache-v2.json)에서
//     이름·영문 요약·지원 표면·저장소·버전만 추려 sources/plugin-directory.json에 둔다(디렉터리 원래 주소는 공개 문서에 없어 직접 받지 않는다).
//  3) build_plugins.mjs로 web/public/plugins-claude.json을 다시 만든다.
//  4) 카탈로그·후보 목록의 플러그인 이름이 최신 목록에 아직 있는지 점검하고, 새로 생기거나 빠진 항목과 함께 보고서를 낸다.
// ChatGPT·Codex 목록(chatgpt.com/plugins)과 Claude 앱 탐색 탭 설치 수는 약관·로그인 문제로 자동으로 받지 않는다(손으로 갱신).
// 실행: node catalog/refresh_plugins.mjs [--local-cache] [--report=보고서.md]   (매일 GitHub Actions: .github/workflows/plugins.yml)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = (f) => path.join(here, 'sources', f)
const pub = (f) => path.join(here, '..', 'web', 'public', f)
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const write = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n')
const flag = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const today = new Date().toISOString().slice(0, 10)
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()
const diff = (before, after) => { const b = new Set(before.map(norm)), a = new Set(after.map(norm)); return { added: after.filter((n) => !b.has(norm(n))), removed: before.filter((n) => !a.has(norm(n))) } }
const lines = [`# 플러그인 목록 갱신 ${today}`, '']

// 1) 공식 마켓플레이스
const MKT_URL = 'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json'
{
  const res = await fetch(MKT_URL)
  if (!res.ok) throw new Error(`마켓플레이스를 받지 못했습니다: ${res.status}`)
  const next = await res.json()
  if (!Array.isArray(next.plugins) || next.plugins.length < 50) throw new Error(`마켓플레이스 형식이 예상과 다릅니다(plugins ${next.plugins?.length})`)
  const prev = read(src('claude-code-marketplace.json'))
  const d = diff(prev.plugins.map((p) => p.name), next.plugins.map((p) => p.name))
  // 내용이 같으면 날짜만 바뀐 파일을 쓰지 않는다(매일 빈 PR 방지)
  const same = JSON.stringify({ ...prev, fetchedAt: undefined }) === JSON.stringify({ ...next, fetchedAt: undefined })
  if (!same) write(src('claude-code-marketplace.json'), { ...next, fetchedAt: today })
  lines.push(`## Claude Code 공식 마켓플레이스: ${next.plugins.length}개${same ? ' (바뀐 것 없음)' : ''}`, `- 새로 생김(${d.added.length}): ${d.added.join(', ') || '없음'}`, `- 빠짐(${d.removed.length}): ${d.removed.join(', ') || '없음'}`, '')
}

// 2) 이 PC의 디렉터리 캐시(선택)
if (process.argv.includes('--local-cache')) {
  const cache = read(path.join(os.homedir(), '.claude', 'plugins', 'plugin-directory-cache-v2.json'))
  const prev = read(src('plugin-directory.json'))
  const listings = cache.listings.map((l) => ({ name: l.name, summary: l.summary, surfaces: l.surfaces, repo: l.source?.repository?.url ?? '', version: l.release?.version ?? '' }))
  const d = diff(prev.listings.map((l) => l.name), listings.map((l) => l.name))
  fs.writeFileSync(src('plugin-directory.json'), JSON.stringify({ fetchedAt: cache.fetchedAt, count: listings.length, note: 'Claude 플러그인 디렉터리 캐시(~/.claude/plugins/plugin-directory-cache-v2.json)에서 이름·요약·지원 표면·저장소·버전만 추림. 카테고리·설치 수는 없음.', listings })) // 커서 한 줄로 둔다
  lines.push(`## Claude 플러그인 디렉터리(이 PC 캐시 ${String(cache.fetchedAt).slice(0, 10)}): ${listings.length}개`, `- 새로 생김(${d.added.length}): ${d.added.slice(0, 60).join(', ') || '없음'}${d.added.length > 60 ? ' …' : ''}`, `- 빠짐(${d.removed.length}): ${d.removed.join(', ') || '없음'}`, '')
}

// 3) 플러그인 찾기용 목록 다시 만들기
execFileSync(process.execPath, [path.join(here, 'build_plugins.mjs')], { stdio: 'inherit' })

// 4) 추천 후보 점검: 카탈로그(종류별 카드·대신 쓸 것·코딩 세부)와 후보 목록의 이름이 최신 목록에 있는지
const catalog = read(path.join(here, 'catalog.json')), cand = read(path.join(here, 'plugin-candidates.json'))
const claudeNames = new Set(read(pub('plugins-claude.json')).plugins.map((p) => norm(p.n)))
const chatgptNames = new Set(read(pub('chatgpt-plugins-2026-11-12.json')).plugins.map((p) => norm(p.n)))
const tp = catalog.taskPlugins
const claudeUsed = [
  ...tp.items.flatMap((i) => [i.pick, i.alt]).filter((p) => p?.kind === 'plugin').map((p) => [p.name, `카드 ${i_task(tp, p.name)}`]),
  ...Object.entries(tp.codingSubPlugins ?? {}).map(([s, p]) => [p.name, `코딩 세부 ${s}`]),
  ...Object.entries(catalog.items.find((i) => i.id === 'cl_plugins')?.byTask ?? {}).map(([t, n]) => [n, `추천 카드 ${t}`]),
  ...Object.entries(cand.claude).flatMap(([t, ns]) => ns.map((n) => [n, `후보 ${t}`])),
]
const chatgptUsed = [
  ...Object.entries(catalog.items.find((i) => i.id === 'cg_plugins')?.byTask ?? {}).map(([t, n]) => [n, `추천 카드 ${t}`]),
  ...Object.entries(cand.chatgpt).flatMap(([t, ns]) => ns.map((n) => [n, `후보 ${t}`])),
]
function i_task(t, name) { return t.items.find((i) => i.pick?.name === name || i.alt?.name === name)?.task ?? '' }
const missing = (used, names) => [...new Map(used.filter(([n]) => !names.has(norm(n))).map(([n, w]) => [n, w])).entries()]
const mc = missing(claudeUsed, claudeNames), mg = missing(chatgptUsed, chatgptNames)
lines.push('## 추천 후보 점검', `- Claude: ${mc.length ? mc.map(([n, w]) => `**${n}**(${w})`).join(', ') + ' — 최신 목록에 없음. 이름이 바뀌었거나 내려갔는지 확인 필요' : '모두 있음'}`,
  `- ChatGPT: ${mg.length ? mg.map(([n, w]) => `**${n}**(${w})`).join(', ') + ' — ChatGPT 목록(손으로 갱신, 2026-11-12)에 없음' : '모두 있음'}`, '')
const report = lines.join('\n')
console.log(report)
const out = flag('report')
if (out) fs.writeFileSync(out, report)
