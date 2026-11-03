import { unzipSync } from 'fflate'
import { parseConversationsJson } from '../parser/chatgpt.ts'
import { basicStats } from '../parser/stats.ts'
import type { Conversation, ParseError } from '../parser/types.ts'

// 메인 스레드 ↔ 워커 메시지. 원문은 브라우저 안에서만 오간다.
export type WorkerIn = { type: 'parse'; data: ArrayBuffer }
export type WorkerOut =
  | { type: 'progress'; stage: 'unzip' | 'parse'; done: number; total: number }
  | { type: 'result'; files: string[]; conversations: Conversation[]; errors: ParseError[]; stats: ReturnType<typeof basicStats>; parserVersion: string }
  | { type: 'error'; message: string }

const isConvFile = (name: string) => /(^|\/)conversations[^/]*\.json$/i.test(name)

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  try {
    const bytes = new Uint8Array(e.data.data)
    const files = unzipSync(bytes, { filter: (f) => isConvFile(f.name) })
    const names = Object.keys(files).sort()
    if (names.length === 0) throw new Error('zip 안에 conversations*.json이 없음')
    const post = (m: WorkerOut) => self.postMessage(m)
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
    post({ type: 'result', files: names, conversations, errors, stats: basicStats(conversations), parserVersion })
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message } satisfies WorkerOut)
  }
}
