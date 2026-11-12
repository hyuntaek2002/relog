// 과업 분류 라벨링용 공개 데이터 표본: WildChat-1M(allenai, ODC-BY)의 한국어·비유해 대화에서 사용자 발화 약 400개를 뽑아
// ChatGPT 내보내기 형식 zip으로 만든다. 앱(?dev=1)에 그대로 넣어 "대화 종류 정답 찍기"로 라벨링하고, run_abc.mjs에 같은 zip을 준다.
// 표본 원문은 타인의 실제 대화이므로 저장소에 넣지 않는다(exports/는 gitignore). 저장소에는 이 스크립트와 라벨 CSV(id·유형만)만 둔다.
// 사용: node eval/classify/sample_wildchat.mjs [목표 발화 수=400] [seed=20261111] [--name=파일 이름 꼬리] [--exclude=이미 뽑은 표본의 ids.json]
//   --exclude: 그 표본에 든 대화는 다시 뽑지 않는다(보강 표본용. 유형별 후보 고르기는 pick_rare.mjs)
//   → exports/public/wildchat-ko-<목표>.zip, exports/public/wildchat-ko-<목표>.ids.json(대화 해시·턴 번호, 재현용)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync, strToU8 } from '../../web/node_modules/fflate/esm/index.mjs'
import { parseConversationsJson } from '../../web/src/parser/chatgpt.ts'
import { normalizeConversations } from '../../web/src/parser/normalize.ts'

const here = dirname(fileURLToPath(import.meta.url))
const flag = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const TARGET = Number(pos[0] ?? 400)
const SEED = Number(pos[1] ?? 20261111)
const NAME = flag('name') ?? String(TARGET)
// --exclude는 쉼표로 여러 개를 줄 수 있다
const EXCLUDE = (flag('exclude') ?? '').split(',').filter(Boolean).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).conversations)
// 대화당 앞에서부터 사용자 발화 몇 개까지(기본 3: 직전 발화 문맥을 보존하면서 한 대화가 표본을 독점하지 않게).
// 반복 탐지 검증용 표본은 대화 뒤쪽에서 다시 말하는 경우가 많아 --turns=20처럼 늘린다.
const MAX_USER_TURNS = Number(flag('turns') ?? 3)
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
      const r = await fetch(url, { headers: { 'user-agent': 'eval-sampler' }, signal: AbortSignal.timeout(30000) }) // 응답 없는 요청에 걸려 멈추지 않게
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

const first = (await page(0, 1)) ?? (await page(1000, 1)) // 첫 쪽이 서버에서 실패할 때가 있어 다른 쪽으로 전체 행 수를 얻는다
if (!first) throw new Error('datasets-server에 연결하지 못했습니다')
const total = first.num_rows_total
const offsets = [...Array(Math.ceil(total / PAGE)).keys()].map((k) => k * PAGE).sort(() => rnd() - 0.5) // 페이지 순서를 seed로 섞는다
const picked = []
const seen = new Set(EXCLUDE)
let ok = 0
const outDir = join(here, '../../exports/public')
mkdirSync(outDir, { recursive: true })
const zipPath = join(outDir, `wildchat-ko-${NAME}.zip`)
// 묶음마다 저장한다: 서버가 느려 중간에 멈춰도 그때까지 받은 표본을 쓸 수 있다
function save() {
  writeFileSync(zipPath, zipSync({ 'conversations.json': strToU8(JSON.stringify(picked)) }))
  writeFileSync(join(outDir, `wildchat-ko-${NAME}.ids.json`), JSON.stringify({ dataset: 'allenai/WildChat-1M', license: 'ODC-BY', where: WHERE, seed: SEED, maxUserTurns: MAX_USER_TURNS, koreanNonToxicTotal: total, conversations: picked.map((c) => c.id) }, null, 1))
}
const CONC = 4 // 한 번에 4쪽씩 받는다(응답이 느린 쪽이 많다). 받은 쪽은 섞인 순서대로 처리하므로 같은 seed면 결과가 같다
for (let k = 0; k < offsets.length && ok < TARGET; k += CONC) {
  const pages = await Promise.all(offsets.slice(k, k + CONC).map((off) => page(off)))
  for (const j of pages) {
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
  }
  save()
  console.log(`쪽 ${Math.min(k + CONC, offsets.length)}/${offsets.length}: 대화 ${picked.length} · 발화 ${ok}/${TARGET}`)
}
save()
console.log({ koreanNonToxicTotal: total, conversations: picked.length, okUtterances: ok, zip: zipPath })
