// 대화-플러그인 맞춤 평가: 캐시(cache_embed.mjs)의 대화마다 방식별 1위 플러그인을 뽑아, 라벨이 없으면 블라인드 목록을 쓰고 있으면 정밀도를 잰다.
// 사용: node eval/recommend/eval_match.mjs <캐시 접두어> <표본 대화 수> <블라인드 출력 파일> [라벨 CSV]
// 방식: A = 지금 방식(대화 종류별로 카탈로그에 정해 둔 Claude 플러그인), B = 코사인 1위, C = 평소 유사도로 표준화한 점수 1위. B·C는 ChatGPT·Claude 목록 각각.
// 라벨 CSV: conversationId,plugin(플랫폼:이름),label(1 맞음|0 안 맞음). 블라인드 파일은 원문이 들어가므로 저장소 밖에만 둔다.
import { readFileSync, writeFileSync } from 'node:fs'
import { convCentroids, bestPlugin } from './pluginMatch.ts'

const [prefix, nSample = '60', blindPath, labelPath] = process.argv.slice(2)
const { dim, inputs } = JSON.parse(readFileSync(prefix + '.json', 'utf8'))
const fb = readFileSync(prefix + '.f32')
const data = new Float32Array(fb.buffer, fb.byteOffset, fb.byteLength / 4)
const pub = new URL('../../exports/plugin-match/', import.meta.url)
const load = (platform, file) => {
  const list = JSON.parse(readFileSync(new URL(file, pub), 'utf8')).plugins
  const b = readFileSync(new URL(`plugin-vecs-${platform}-2026-11-12.bin`, pub))
  return { platform, list, vecs: new Int8Array(b.buffer, b.byteOffset, b.byteLength) }
}
const P = [load('chatgpt', 'plugins-chatgpt-2026-11-12.json'), load('claude', 'plugins-claude-2026-11-10.json')]
// D: 후보를 인기·대표 플러그인으로 좁힌 C. ChatGPT = 카테고리 화면 앞 20위 안, Claude = 설치 수 상위 300
const subset = (p, keep) => {
  const idx = p.list.map((x, i) => i).filter((i) => keep(p.list[i], i))
  const dim = p.vecs.length / p.list.length
  const vecs = new Int8Array(idx.length * dim)
  idx.forEach((i, j) => vecs.set(p.vecs.subarray(i * dim, (i + 1) * dim), j * dim))
  return { platform: p.platform, pop: true, list: idx.map((i) => p.list[i]), vecs }
}
const topInstalls = new Set(P[1].list.map((x, i) => [x.i ?? -1, i]).sort((a, b) => b[0] - a[0]).slice(0, 300).map(([, i]) => i))
const POP = [subset(P[0], (x) => x.r < 20), subset(P[1], (x, i) => topInstalls.has(i))]
console.log('후보 수 D:', POP.map((p) => `${p.platform} ${p.list.length}`).join(', '))
const CAND = JSON.parse(readFileSync(new URL('../../catalog/plugin-candidates.json', import.meta.url), 'utf8'))
const catalog = JSON.parse(readFileSync(new URL('../../catalog/catalog.json', import.meta.url), 'utf8'))
const TASK_MAP = { coding: 'coding', writing: 'writing', learning: 'learning', work_doc: 'workdoc', search: 'search', ideation: 'ideation', translation: 'translation', chat: 'counseling' }
const fixedPick = Object.fromEntries(catalog.taskPlugins.items.map((e) => [e.task, e.pick?.name ?? null]))

const cents = convCentroids(inputs.map((u) => u.conversationId), (i) => data.subarray(i * dim, (i + 1) * dim), dim)
// 결정적 표본: 대화 id 정렬 후 일정 간격
const convIds = [...cents.keys()].sort()
const step = Math.max(1, Math.floor(convIds.length / Number(nSample)))
const sample = convIds.filter((_, i) => i % step === 0).slice(0, Number(nSample))

const rows = sample.map((cid) => {
  const us = inputs.filter((u) => u.conversationId === cid)
  const types = us.map((u) => u.taskType).reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map())
  const task = TASK_MAP[[...types].sort((a, b) => b[1] - a[1])[0][0]]
  const picks = { A: fixedPick[task] ? `claude:${fixedPick[task]}` : null }
  // E: 대화 종류별 후보 중 가장 가까운 것. F: 후보 첫째(기본값, 맞춤 없음)
  for (const p of P) {
    const names = CAND[p.platform][task] ?? []
    if (!names.length) continue
    const sub = subset(p, (x) => names.includes(x.n))
    const r = bestPlugin(cents.get(cid), sub.vecs, sub.list, true)
    picks[`E-${p.platform}`] = { name: `${p.platform}:${sub.list[r.plugin].n}`, z: r.z, sim: r.sim }
    picks[`F-${p.platform}`] = `${p.platform}:${names[0]}`
  }
  for (const p of [...P, ...POP]) for (const [k, useZ] of [['B', false], ['C', true]]) {
    if (p.pop && k === 'B') continue
    const r = bestPlugin(cents.get(cid), p.vecs, p.list, useZ)
    picks[`${p.pop ? 'D' : k}-${p.platform}`] = { name: `${p.platform}:${p.list[r.plugin].n}`, z: r.z, sim: r.sim }
  }
  return { cid, task, text: us.map((u) => u.text.replace(/\s+/g, ' ').slice(0, 160)).join(' / ').slice(0, 400), picks }
})

if (process.env.EF) { writeFileSync(process.env.EF, JSON.stringify(Object.fromEntries(rows.map((r) => [r.cid, [...new Set(["A", "E-chatgpt", "F-chatgpt", "E-claude", "F-claude"].map((k) => r.picks[k]).filter(Boolean).map((x) => (typeof x === "string" ? x : x.name)))].sort()])))) }
if (!labelPath) {
  // 블라인드: 방식 표시 없이 대화마다 후보 이름을 이름순으로
  const desc = new Map(P.flatMap((p) => p.list.map((x) => [`${p.platform}:${x.n}`, x.s])))
  const out = rows.map((r) => {
    const names = [...new Set(Object.values(r.picks).filter(Boolean).map((x) => (typeof x === 'string' ? x : x.name)))].sort()
    return `## ${r.cid}\n${r.text}\n${names.map((n) => `- ${n} — ${(desc.get(n) ?? '').slice(0, 120)}`).join('\n')}`
  })
  writeFileSync(blindPath, out.join('\n\n'))
  console.log('blind', rows.length, '→', blindPath)
} else {
  const lab = new Map(readFileSync(labelPath, 'utf8').split('\n').slice(1).filter(Boolean).map((l) => { const [c, p, y] = l.split(','); return [`${c}|${p}`, y.trim() === '1'] }))
  const methods = Object.keys(rows[0].picks)
  for (const m of methods) {
    const xs = rows.map((r) => r.picks[m]).map((x, i) => (x ? { name: typeof x === 'string' ? x : x.name, z: x.z ?? Infinity, ok: lab.get(`${rows[i].cid}|${typeof x === 'string' ? x : x.name}`) } : null)).filter(Boolean)
    const at = (t) => { const s = xs.filter((x) => x.z >= t); return `${s.filter((x) => x.ok).length}/${s.length}` }
    console.log(m.padEnd(10), '전체', at(-Infinity), (m.startsWith('C') || m.startsWith('E')) ? `· z≥1 ${at(1)} · z≥2 ${at(2)} · z≥3 ${at(3)} · z≥4 ${at(4)}` : '')
  }
}
