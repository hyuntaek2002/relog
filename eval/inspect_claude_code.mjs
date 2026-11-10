// Claude Code 세션 폴더를 파서에 넣어 숫자만 출력한다(본문 출력 없음). 사용: node eval/inspect_claude_code.mjs <projects 폴더>
import fs from 'node:fs'
import path from 'node:path'
import { parseClaudeCodeSession } from '../web/src/parser/claudeCode.ts'
import { normalizeConversations } from '../web/src/parser/normalize.ts'
const root = process.argv[2]
const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.jsonl$/i.test(e.name)) files.push(p) } }
walk(root)
let convs = 0, skipped = 0, users = 0, assistants = 0, bytes = 0, maxUser = 0, tokens = 0
const tools = new Map()
const all = []
const t0 = Date.now()
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8'); bytes += text.length
  const c = parseClaudeCodeSession(text, f)
  if (!c) { skipped++; continue }
  convs++; all.push(c)
  const u = c.turns.filter((t) => t.role === 'user'); users += u.length; assistants += c.turns.length - u.length
  maxUser = Math.max(maxUser, u.length); tokens += u.reduce((s, t) => s + t.tokenEstimate, 0)
  for (const n of c.toolNames) tools.set(n, (tools.get(n) ?? 0) + 1)
}
console.log({ files: files.length, conversations: convs, skippedNoHuman: skipped, userTurns: users, assistantTurns: assistants, maxUserTurnsInOne: maxUser, userTokenEstimate: tokens, readMB: Math.round(bytes / 1048576), ms: Date.now() - t0 })
console.log('tools(대화 수):', [...tools].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, k]) => `${n} ${k}`).join(', '))
const us = normalizeConversations(all)
const st = {}; for (const u of us) st[u.status] = (st[u.status] ?? 0) + 1
console.log('normalize:', st)
