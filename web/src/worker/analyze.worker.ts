import { Unzip, UnzipInflate } from 'fflate'
import { parseConversationsJson, PARSER_VERSION } from '../parser/chatgpt.ts'
import { ClaudeCodeSessionBuilder, dedupeForkedSessions } from '../parser/claudeCode.ts'
import { NORMALIZER_VERSION, normalizeConversations, normalizeStats, type NormalizeStats, type Utterance } from '../parser/normalize.ts'
import { basicStats, type BasicStats } from '../parser/stats.ts'
import type { Conversation, ParseError } from '../parser/types.ts'
import { installFetchAudit, setAuditProbes, takeAuditRecords, type NetRecord } from './netaudit.ts'

installFetchAudit('analyze-worker') // 이 워커는 네트워크를 쓰지 않아야 한다. 기록이 있으면 그 자체가 문제.

// 메인 스레드 ↔ 워커 메시지. 원문은 브라우저 안에서만 오간다.
// zip 여러 개(앱 내보내기 + Claude Code projects 폴더 zip)를 한 번에 받고, 항목 단위로 스트리밍 해제해 메모리를 아낀다.
export type WorkerIn = { type: 'parse'; files: File[] }
export type WorkerOut =
  | { type: 'progress'; stage: 'unzip' | 'parse' | 'normalize'; done: number; total: number }
  | {
      type: 'result'
      files: string[]
      conversations: Conversation[]
      errors: ParseError[]
      stats: BasicStats
      utterances: Utterance[]
      normStats: NormalizeStats
      parserVersion: string
      normalizerVersion: string
      net: NetRecord[]
    }
  | { type: 'error'; message: string }

const isConvFile = (name: string) => /(^|\/)conversations[^/]*\.json$/i.test(name)
const isSessionFile = (name: string) => /\.jsonl$/i.test(name)
const CHUNK = 8 * 1024 * 1024

// zip 하나를 조각 단위로 읽어 항목별로 처리. json은 모아서 파싱, jsonl은 줄 단위로 바로 파서에 넣고 버린다.
async function readZip(file: File, out: { names: string[]; conversations: Conversation[]; errors: ParseError[] }, post: (m: WorkerOut) => void) {
  const unz = new Unzip()
  unz.register(UnzipInflate)
  unz.onfile = (f) => {
    if (isConvFile(f.name)) {
      const chunks: Uint8Array[] = []
      f.ondata = (err, data, final) => {
        if (err) { out.errors.push({ conversationId: null, reason: `${f.name}: ${err.message}` }); return }
        chunks.push(data)
        if (!final) return
        const dec = new TextDecoder()
        const text = chunks.map((c, i) => dec.decode(c, { stream: i < chunks.length - 1 })).join('')
        try {
          const r = parseConversationsJson(JSON.parse(text))
          out.conversations.push(...r.conversations); out.errors.push(...r.errors)
        } catch (e) { out.errors.push({ conversationId: null, reason: `${f.name}: ${(e as Error).message}` }) }
        out.names.push(f.name)
        post({ type: 'progress', stage: 'parse', done: out.names.length, total: out.names.length })
      }
      f.start()
    } else if (isSessionFile(f.name)) {
      const b = new ClaudeCodeSessionBuilder(f.name)
      const dec = new TextDecoder()
      let rest = ''
      f.ondata = (err, data, final) => {
        if (err) { out.errors.push({ conversationId: null, reason: `${f.name}: ${err.message}` }); return }
        rest += dec.decode(data, { stream: !final })
        const lines = rest.split('\n')
        rest = final ? '' : (lines.pop() ?? '')
        for (const l of lines) b.pushLine(l)
        if (!final) return
        const conv = b.finish()
        if (conv) { out.conversations.push(conv); out.names.push(f.name) }
        post({ type: 'progress', stage: 'parse', done: out.names.length, total: out.names.length })
      }
      f.start()
    }
  }
  for (let off = 0; off < file.size; off += CHUNK) {
    const buf = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer())
    unz.push(buf, off + CHUNK >= file.size)
    post({ type: 'progress', stage: 'unzip', done: Math.min(file.size, off + CHUNK), total: file.size })
  }
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const post = (m: WorkerOut) => self.postMessage(m)
  try {
    const out = { names: [] as string[], conversations: [] as Conversation[], errors: [] as ParseError[] }
    for (const f of e.data.files) await readZip(f, out, post)
    if (out.names.length === 0) throw new Error('zip 안에 conversations*.json(앱 내보내기)이나 *.jsonl(Claude Code 세션)이 없음')
    out.conversations = dedupeForkedSessions(out.conversations)
    const utterances = normalizeConversations(out.conversations)
    setAuditProbes(utterances.map((u) => u.text))
    post({ type: 'progress', stage: 'normalize', done: 1, total: 1 })
    post({
      type: 'result',
      files: out.names.sort(),
      conversations: out.conversations,
      errors: out.errors,
      stats: basicStats(out.conversations),
      utterances,
      normStats: normalizeStats(utterances),
      parserVersion: PARSER_VERSION,
      normalizerVersion: NORMALIZER_VERSION,
      net: takeAuditRecords(),
    })
  } catch (err) {
    post({ type: 'error', message: (err as Error).message })
  }
}
