import { unzipSync } from 'fflate'
import { parseConversationsJson } from '../parser/chatgpt.ts'
import { NORMALIZER_VERSION, normalizeConversations, normalizeStats, type NormalizeStats, type Utterance } from '../parser/normalize.ts'
import { basicStats, type BasicStats } from '../parser/stats.ts'
import type { Conversation, ParseError } from '../parser/types.ts'
import { installFetchAudit, setAuditProbes, takeAuditRecords, type NetRecord } from './netaudit.ts'

installFetchAudit('analyze-worker') // 이 워커는 네트워크를 쓰지 않아야 한다. 기록이 있으면 그 자체가 문제.

// 메인 스레드 ↔ 워커 메시지. 원문은 브라우저 안에서만 오간다.
export type WorkerIn = { type: 'parse'; data: ArrayBuffer }
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

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const post = (m: WorkerOut) => self.postMessage(m)
  try {
    const bytes = new Uint8Array(e.data.data)
    const files = unzipSync(bytes, { filter: (f) => isConvFile(f.name) })
    const names = Object.keys(files).sort()
    if (names.length === 0) throw new Error('zip 안에 conversations*.json이 없음')
    post({ type: 'progress', stage: 'unzip', done: names.length, total: names.length })

    const conversations: Conversation[] = []
    const errors: ParseError[] = []
    let parserVersion = ''
    const dec = new TextDecoder()
    names.forEach((n, i) => {
      const r = parseConversationsJson(JSON.parse(dec.decode(files[n])))
      parserVersion = r.parserVersion
      conversations.push(...r.conversations)
      errors.push(...r.errors)
      post({ type: 'progress', stage: 'parse', done: i + 1, total: names.length })
    })
    const utterances = normalizeConversations(conversations)
    setAuditProbes(utterances.map((u) => u.text))
    post({ type: 'progress', stage: 'normalize', done: 1, total: 1 })
    post({
      type: 'result',
      files: names,
      conversations,
      errors,
      stats: basicStats(conversations),
      utterances,
      normStats: normalizeStats(utterances),
      parserVersion,
      normalizerVersion: NORMALIZER_VERSION,
      net: takeAuditRecords(),
    })
  } catch (err) {
    post({ type: 'error', message: (err as Error).message })
  }
}
