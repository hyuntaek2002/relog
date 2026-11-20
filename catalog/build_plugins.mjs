// 플러그인 찾기용 데이터(web/public/plugins-claude.json) 생성. 보통은 refresh_plugins.mjs가 부른다.
// 입력: sources/plugin-directory.json(Claude 플러그인 디렉터리 캐시: 이름·영문 요약·저장소, refresh_plugins.mjs --local-cache로 갱신),
//       sources/claude-code-marketplace.json(Claude Code 공식 마켓플레이스, 공개 GitHub. 디렉터리에 없는 항목만 더한다),
//       sources/claude-app-plugins-top100-by-category-<날짜>.tsv(앱 탐색 탭 실측: 이름·설치 수·카테고리 라벨·slug·제작자),
//       sources/claude-app-only-plugins-<날짜>.json(디렉터리에 없는 앱 전용 항목의 설명), sources/plugin-ko-oneliners.tsv(한국어 한 줄).
// 실행: node catalog/build_plugins.mjs [앱 탐색 탭 실측 날짜, 기본 2026-11-10]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const DATE = process.argv[2] ?? '2026-11-10'
const src = (f) => path.join(here, 'sources', f)
const slugMap = Object.fromEntries(fs.readFileSync(src('claude-app-plugin-category-slugs.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).join(' ').split(/\s(?=[a-z-]+=)/).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1).trim()] }))
const labelToSlug = Object.fromEntries(Object.entries(slugMap).map(([k, v]) => [v, k]))
const byLen = Object.values(slugMap).sort((a, b) => b.length - a.length)
// "A, B 및 C" → 라벨 목록. 라벨 자체에 '및'이 있어 긴 라벨부터 탐욕적으로 맞춘다
function parseCats(title) { const out = []; let rest = title.trim(); while (rest) { const hit = byLen.find((l) => rest.startsWith(l)); if (!hit) break; out.push(hit); rest = rest.slice(hit.length).replace(/^(, | 및 )/, '') } return out }
const rows = fs.readFileSync(src(`claude-app-plugins-top100-by-category-${DATE}.tsv`), 'utf8').split('\n').filter(Boolean).map((l) => { const [name, inst, cats, slugs, maker] = l.split('\t'); return { name, installs: inst ? Number(inst) : null, catSlugs: [...new Set([...parseCats(cats).map((c) => labelToSlug[c]), ...slugs.split(',').filter(Boolean)])], maker } })
const dirFile = JSON.parse(fs.readFileSync(src('plugin-directory.json'), 'utf8'))
const dir = dirFile.listings
const mkt = JSON.parse(fs.readFileSync(src('claude-code-marketplace.json'), 'utf8'))
const extra = JSON.parse(fs.readFileSync(src(`claude-app-only-plugins-${DATE}.json`), 'utf8'))
const ko = Object.fromEntries(fs.readFileSync(src('plugin-ko-oneliners.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')))
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim()
const app = new Map(rows.map((r) => [norm(r.name), r]))
const trim = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 180)
const out = dir.map((d) => { const a = app.get(norm(d.name)); return { n: d.name, s: trim(d.summary), r: d.repo, c: a?.catSlugs ?? [], i: a?.installs ?? null, a: a ? /Anthropic 작성/.test(a.maker) : false, k: ko[d.name] } })
const dirNames = new Set(dir.map((d) => norm(d.name)))
for (const r of rows) if (!dirNames.has(norm(r.name))) out.push({ n: r.name, s: trim(extra[r.name]), r: '', c: r.catSlugs, i: r.installs, a: /Anthropic 작성/.test(r.maker), k: ko[r.name] })
// 공식 마켓플레이스에만 있는 항목(디렉터리·탐색 탭에 없음)
const known = new Set(out.map((p) => norm(p.n)))
const mktRepo = (p) => p.homepage || (typeof p.source === 'object' ? p.source.url ?? '' : 'https://github.com/anthropics/claude-plugins-official')
for (const p of mkt.plugins) if (!known.has(norm(p.name))) out.push({ n: p.name, s: trim(p.description), r: mktRepo(p), c: [], i: null, a: p.author?.name === 'Anthropic', k: ko[p.name] })
out.sort((x, y) => (y.i || 0) - (x.i || 0) || x.n.localeCompare(y.n))
const at = (s) => String(s ?? '').slice(0, 10)
const file = { format: 'relog-plugins-1', fetchedAt: at(dirFile.fetchedAt), note: `플러그인 디렉터리 캐시(${at(dirFile.fetchedAt)})와 Claude Code 공식 마켓플레이스(${at(mkt.fetchedAt)}), Claude 앱 탐색 탭 실측(${DATE}, 카테고리당 설치 수 상위 100까지)을 합친 것. 카테고리·설치 수가 없는 항목은 탐색 탭 상위 100 밖이거나 실측 뒤 새로 생긴 것.`, categories: slugMap, plugins: out }
const dest = path.join(here, '..', 'web', 'public', 'plugins-claude.json')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, JSON.stringify(file))
console.log({ total: out.length, withCategory: out.filter((p) => p.c.length).length, withInstalls: out.filter((p) => p.i != null).length, withKo: out.filter((p) => p.k).length, koUnmatched: Object.keys(ko).filter((n) => !out.some((p) => p.n === n)), bytes: fs.statSync(dest).size })
