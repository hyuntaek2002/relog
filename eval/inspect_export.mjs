// 내보내기 zip의 구조만 출력한다(키·타입·건수). 대화 원문은 출력하지 않는다.
// 사용: node eval/inspect_export.mjs exports/conversations-000.zip
import { readFileSync } from 'node:fs'
import { unzipSync } from '../web/node_modules/fflate/esm/index.mjs'
import { parseConversationsJson } from '../web/src/parser/chatgpt.ts'
import { basicStats } from '../web/src/parser/stats.ts'

const files = unzipSync(new Uint8Array(readFileSync(process.argv[2])))
console.log('files:', Object.entries(files).map(([n, b]) => `${n} (${(b.length / 1048576).toFixed(1)}MB)`))

const count = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)
const fmt = (m) => Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))

for (const [name, bytes] of Object.entries(files)) {
  if (!name.endsWith('.json')) continue
  const json = JSON.parse(new TextDecoder().decode(bytes))
  console.log(`\n== ${name}: top-level ${Array.isArray(json) ? `array[${json.length}]` : typeof json}`)
  if (!Array.isArray(json)) continue
  const convKeys = new Map(), msgKeys = new Map(), senders = new Map(), partTypes = new Map(), ctKeys = new Map()
  let msgs = 0, emptyText = 0, noTime = 0
  for (const c of json) {
    for (const k of Object.keys(c)) count(convKeys, k)
    // Claude 형식
    for (const m of c.chat_messages ?? []) {
      msgs++
      for (const k of Object.keys(m)) count(msgKeys, k)
      count(senders, m.sender)
      if (!m.created_at) noTime++
      if (!(m.text ?? '').trim() && !(m.content ?? []).some((p) => p.type === 'text' && p.text?.trim())) emptyText++
      for (const p of m.content ?? []) { count(partTypes, p.type); for (const k of Object.keys(p)) count(ctKeys, k) }
    }
    // ChatGPT 형식
    for (const node of Object.values(c.mapping ?? {})) {
      const m = node.message
      if (!m) { count(msgKeys, '(null message)'); continue }
      msgs++
      for (const k of Object.keys(m)) count(msgKeys, k)
      count(senders, m.author?.role)
      count(partTypes, m.content?.content_type)
      if (!m.create_time) noTime++
    }
  }
  console.log('conversation keys:', fmt(convKeys))
  console.log('message keys:', fmt(msgKeys))
  console.log('senders/roles:', fmt(senders))
  console.log('content part types:', fmt(partTypes))
  if (ctKeys.size) console.log('content part keys:', fmt(ctKeys))
  console.log({ messages: msgs, emptyText, noCreatedAt: noTime })

  const r = parseConversationsJson(json)
  console.log('\nparser:', r.parserVersion, 'errors:', r.errors.length, r.errors.slice(0, 5))
  const s = basicStats(r.conversations)
  console.log('stats:', s)
  const perConv = r.conversations.map((c) => c.turns.filter((t) => t.role === 'user').length).sort((a, b) => b - a)
  console.log('user turns per conversation (top 15):', perConv.slice(0, 15), 'median:', perConv[Math.floor(perConv.length / 2)])
  const dates = r.conversations.map((c) => c.createdAt).filter(Boolean).sort()
  if (dates.length) console.log('date range:', new Date(dates[0]).toISOString().slice(0, 10), '~', new Date(dates.at(-1)).toISOString().slice(0, 10))
}

// 정규화 상태 분포(실제 파일 기준). 원문은 출력하지 않는다.
const { normalizeConversations, normalizeStats } = await import('../web/src/parser/normalize.ts')
for (const [name, bytes] of Object.entries(files)) {
  if (!name.endsWith('.json')) continue
  const r = parseConversationsJson(JSON.parse(new TextDecoder().decode(bytes)))
  const us = normalizeConversations(r.conversations)
  console.log('\nnormalize:', normalizeStats(us))
  const langs = new Map(); us.forEach((u) => u.codeLangs.forEach((l) => langs.set(l, (langs.get(l) ?? 0) + 1)))
  console.log('code langs:', Object.fromEntries(langs))
  console.log('skipped lengths:', us.filter((u) => u.status === 'skipped').map((u) => u.text.length).join(' '))
  console.log('context_required lengths:', us.filter((u) => u.status === 'context_required').map((u) => u.text.length).join(' '))
}
