// 사용자 단위 점검: 캐시(cache_embed.mjs)의 대화 종류별로 후보 점수(z)를 모두 찍는다. 맞춤 선택을 제품에 넣을지 판단할 때 쓴 점검.
// 사용: node eval/recommend/task_picks.mjs <캐시 접두어> <chatgpt|claude>
import { readFileSync } from 'node:fs'
import { convCentroids } from './pluginMatch.ts'
import { Q_SCALE } from './pluginMatch.ts'
import { TASK_MAP } from '../../web/src/recommend/snapshot.ts'

const [prefix, platform] = process.argv.slice(2)
const { dim, inputs } = JSON.parse(readFileSync(prefix + '.json', 'utf8'))
const fb = readFileSync(prefix + '.f32')
const data = new Float32Array(fb.buffer, fb.byteOffset, fb.byteLength / 4)
const pub = new URL('../../exports/plugin-match/', import.meta.url)
const list = JSON.parse(readFileSync(new URL(platform === 'chatgpt' ? 'plugins-chatgpt-2026-11-12.json' : 'plugins-claude-2026-11-10.json', pub), 'utf8')).plugins
const vb = readFileSync(new URL(`plugin-vecs-${platform}-2026-11-12.bin`, pub))
const vecs = new Int8Array(vb.buffer, vb.byteOffset, vb.byteLength)
const cand = JSON.parse(readFileSync(new URL('../../catalog/plugin-candidates.json', import.meta.url), 'utf8'))[platform]
// Claude Code 기록은 제품에서 모두 코딩으로 센다
const tasks = inputs.map((u) => (u.group === 'code' ? 'coding' : TASK_MAP[u.taskType] ?? ''))
const cents = convCentroids(tasks, (i) => data.subarray(i * dim, (i + 1) * dim), dim)
for (const [task, names] of Object.entries(cand)) {
  const n = tasks.filter((t) => t === task).length
  const q = cents.get(task)
  if (!q || n < 20 || !names.length) continue
  const rows = names.map((name) => {
    const p = list.findIndex((x) => x.n === name)
    let d = 0
    for (let k = 0; k < dim; k++) d += q[k] * vecs[p * dim + k]
    const sim = d * Q_SCALE
    return { name, sim, z: (sim - list[p].m) / list[p].d }
  }).sort((a, b) => b.z - a.z)
  console.log(`${task} (${n}): ` + rows.map((r) => `${r.name} z=${r.z.toFixed(2)} sim=${r.sim.toFixed(3)}`).join(' · '))
}
