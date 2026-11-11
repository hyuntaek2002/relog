// 과업 분류 라벨링용 공개 데이터 표본: WildChat-1M(allenai, ODC-BY)의 한국어·비유해 대화에서 사용자 발화 약 400개를 뽑아
// ChatGPT 내보내기 형식 zip으로 만든다. 앱(?dev=1)에 그대로 넣어 "대화 종류 정답 찍기"로 라벨링하고, run_abc.mjs에 같은 zip을 준다.
// 표본 원문은 타인의 실제 대화이므로 저장소에 넣지 않는다(exports/는 gitignore). 저장소에는 이 스크립트와 라벨 CSV(id·유형만)만 둔다.
// 사용: node eval/classify/sample_wildchat.mjs [목표 발화 수=400] [seed=20261111]
//   → exports/public/wildchat-ko-<목표>.zip, exports/public/wildchat-ko-<목표>.ids.json(대화 해시·턴 번호, 재현용)
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync, strToU8 } from '../../web/node_modules/fflate/esm/index.mjs'
import { parseConversationsJson } from '../../web/src/parser/chatgpt.ts'
import { normalizeConversations } from '../../web/src/parser/normalize.ts'

const here = dirname(fileURLToPath(import.meta.url))
const TARGET = Number(process.argv[2] ?? 400)
const SEED = Number(process.argv[3] ?? 20261111)
const MAX_USER_TURNS = 3 // 대화당 앞에서부터 사용자 발화 3개까지(직전 발화 문맥을 보존하면서 한 대화가 표본을 독점하지 않게)
const PAGE = 20 // 작게: 긴 답변이 든 행이 섞이면 100행 응답이 서버에서 자주 실패한다(실측)
const API = 'https://datasets-server.huggingface.co/filter'
const WHERE = `"language"='Korean' AND "toxic"=false`

let s = SEED >>> 0
const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }

async function page(offset, length = PAGE) {
  const url = `${API}?dataset=${encodeURIComponent('allenai/WildChat-1M')}&config=default&split=train&where=${encodeURIComponent(WHERE)}&offset=${offset}&length=${length}`
  let last = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'relog-eval-sampler' }, signal: AbortSignal.timeout(30000) }) // 응답 없는 요청에 걸려 멈추지 않게
      if (r.ok) return await r.json()
      last = `HTTP ${r.status}`
      if (r.status !== 429 && r.status < 500) break
    } catch (e) { last = e.message }
    await new Promise((res) => setTimeout(res, 5000))
  }
  console.log(`offset ${offset}: 건너뜀(${last})`) // 큰 행이 섞인 페이지는 서버가 실패할 때가 있다 → 그 페이지만 빼고 계속
  return null
}

// WildChat 한 행 → ChatGPT 내보내기 대화(mapping + current_node). 메시지 id = <대화 해시>:<턴 번호>
function toExport(row) {
  const id = row.conversation_hash
  const t0 = Math.floor(Date.parse(row.timestamp) / 1000) || 1700000000
  const mapping = {}
  const root = `${id}:root`
  mapping[root] = { id: root, message: null, parent: null, children: [] }
  let parent = root, users = 0, t = t0
  for (let i = 0; i < row.conversation.length; i++) {
    const m = row.conversation[i]
    if (m.role === 'user' && users === MAX_USER_TURNS) break
    if (m.role === 'user') users++
    const mid = `${id}:${i}`
    const text = m.role === 'user' ? String(m.content ?? '') : String(m.content ?? '').slice(0, 600) // 답변은 문맥 판단용이라 앞부분만
    mapping[mid] = { id: mid, message: { id: mid, author: { role: m.role === 'user' ? 'user' : 'assistant' }, create_time: (t += 60), content: { content_type: 'text', parts: [text] }, metadata: {}, recipient: 'all' }, parent, children: [] }
    mapping[parent].children.push(mid)
    parent = mid
  }
  return { title: '', create_time: t0, update_time: t, mapping, current_node: parent, conversation_id: id, id }
}

const first = await page(0, 1)
if (!first) throw new Error('datasets-server에 연결하지 못했습니다')
const total = first.num_rows_total
const offsets = [...Array(Math.ceil(total / PAGE)).keys()].map((k) => k * PAGE).sort(() => rnd() - 0.5) // 페이지 순서를 seed로 섞는다
const picked = []
const seen = new Set()
let ok = 0
for (const off of offsets) {
  if (ok >= TARGET) break
  const j = await page(off)
  if (!j) continue
  const rows = j.rows.map((r) => r.row).sort(() => rnd() - 0.5)
  for (const row of rows) {
    if (ok >= TARGET) break
    if (seen.has(row.conversation_hash) || !Array.isArray(row.conversation) || row.conversation.some((m) => m.toxic)) continue
    seen.add(row.conversation_hash)
    const conv = toExport(row)
    // 앱과 같은 파서·정규화로 "분석 대상(ok)" 발화가 하나라도 있는 대화만 쓴다
    const utts = normalizeConversations(parseConversationsJson([conv]).conversations)
    const n = utts.filter((u) => u.status === 'ok').length
    if (n === 0 || utts.some((u) => u.text.length > 3000)) continue // 지나치게 긴 붙여넣기는 라벨링이 어려워 제외
    picked.push(conv)
    ok += n
  }
  console.log(`offset ${off}: 대화 ${picked.length} · 발화 ${ok}/${TARGET}`)
}
const outDir = join(here, '../../exports/public')
mkdirSync(outDir, { recursive: true })
const zipPath = join(outDir, `wildchat-ko-${TARGET}.zip`)
writeFileSync(zipPath, zipSync({ 'conversations.json': strToU8(JSON.stringify(picked)) }))
writeFileSync(join(outDir, `wildchat-ko-${TARGET}.ids.json`), JSON.stringify({ dataset: 'allenai/WildChat-1M', license: 'ODC-BY', where: WHERE, seed: SEED, maxUserTurns: MAX_USER_TURNS, koreanNonToxicTotal: total, conversations: picked.map((c) => c.id) }, null, 1))
console.log({ koreanNonToxicTotal: total, conversations: picked.length, okUtterances: ok, zip: zipPath })
