import { foldTask, type Prediction } from '../classify/classifier.ts'
import type { Utterance } from '../parser/normalize.ts'
import type { Conversation } from '../parser/types.ts'

// 발화 대장: conversationId + messageId + 내용 해시가 키. 편집·재생성된 메시지는 해시가 달라 새 발화로 취급.
// 집계는 업로드 시점이 아니라 메시지 생성일 기준 주 단위. 대장만 있으면 언제든 재계산할 수 있다.

export interface AnalysisVersion {
  parserVersion: string
  normalizerVersion: string
  modelVersion: string
  classifierVersion: string
  detectorVersion: string
  catalogVersion: string
  recommendationRuleVersion: string
}
// 다시 말한 지시 찾기를 제품에서 뺀 뒤(2026-11-24) detectorVersion 자리에 넣는 값
export const DETECTOR_OFF = 'det-off'
export const versionKey = (v: AnalysisVersion) => [v.parserVersion, v.normalizerVersion, v.modelVersion, v.classifierVersion, v.detectorVersion].join('|')

export interface LedgerEntry {
  key: string // `${conversationId}#${messageId}#${hash}`
  platform: 'chatgpt' | 'claude'
  conversationId: string
  messageId: string
  hash: string
  createdAt: number | null
  status: Utterance['status']
  hasCode: boolean
  tokenEstimate: number
  taskType: string | null // ok 발화만
  versionKey: string
  analyzedAt: number
}

// 32비트 FNV-1a 두 번(시드 다르게) → 64비트 상당. 암호학적 용도 아님, 중복 판정용.
export function contentHash(text: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
    return h.toString(16).padStart(8, '0')
  }
  return fnv(0x811c9dc5) + fnv(0x01000193)
}

export function buildLedger(args: {
  platform: 'chatgpt' | 'claude'
  utterances: Utterance[]
  okIds: string[]
  preds: Prediction[]
  version: AnalysisVersion
  analyzedAt?: number
}): LedgerEntry[] {
  const { platform, utterances, okIds, preds, version } = args
  const analyzedAt = args.analyzedAt ?? Date.now()
  const vk = versionKey(version)
  const typeById = new Map(okIds.map((id, i) => [id, preds[i]?.type ?? null]))
  return utterances.map((u) => {
    const hash = contentHash(u.text)
    return {
      key: `${u.conversationId}#${u.messageId}#${hash}`,
      platform,
      conversationId: u.conversationId,
      messageId: u.messageId,
      hash,
      createdAt: u.createdAt,
      status: u.status,
      hasCode: u.hasCode,
      tokenEstimate: u.tokenEstimate,
      taskType: u.status === 'ok' ? (typeById.get(u.messageId) ?? null) : null,
      versionKey: vk,
      analyzedAt,
    }
  })
}

// 주 시작(월요일 00:00, 로컬 시간)
export function weekStart(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  const day = (d.getDay() + 6) % 7 // 월=0
  d.setDate(d.getDate() - day)
  return d.getTime()
}

export interface PeriodSnapshot {
  periodStart: number
  periodEnd: number // 다음 주 시작(배타)
  versionKey: string
  platform: 'chatgpt' | 'claude'
  userTurnCount: number // 전체 사용자 발화(제외 포함)
  okCount: number
  conversationCount: number // 이 주에 발화가 있는 대화
  longConversationCount: number // 그중 전체 ok 발화 10개 이상
  codeCount: number
  taskCounts: Record<string, number>
  hourHistogram: number[]
}

// 대장 전체에서 주별 스냅샷을 다시 만든다. 같은 versionKey의 항목만 쓴다(버전이 다른 기간은 비교하지 않음).
// 같은 messageId가 여러 해시로 있으면(편집) 가장 늦게 분석된 것만.
export function aggregateWeekly(entries: LedgerEntry[], vk: string): PeriodSnapshot[] {
  const latest = new Map<string, LedgerEntry>()
  for (const e of entries) {
    if (e.versionKey !== vk || e.createdAt == null) continue
    const k = `${e.conversationId}#${e.messageId}`
    const prev = latest.get(k)
    if (!prev || e.analyzedAt > prev.analyzedAt) latest.set(k, e)
  }
  const all = [...latest.values()]
  const okPerConv = new Map<string, number>()
  for (const e of all) if (e.status === 'ok') okPerConv.set(e.conversationId, (okPerConv.get(e.conversationId) ?? 0) + 1)

  const weeks = new Map<number, PeriodSnapshot>()
  for (const e of all) {
    const ws = weekStart(e.createdAt!)
    let w = weeks.get(ws)
    if (!w) {
      w = { periodStart: ws, periodEnd: ws + 7 * 86400000, versionKey: vk, platform: e.platform, userTurnCount: 0, okCount: 0, conversationCount: 0, longConversationCount: 0, codeCount: 0, taskCounts: {}, hourHistogram: new Array(24).fill(0) }
      weeks.set(ws, w)
    }
    w.userTurnCount++
    w.hourHistogram[new Date(e.createdAt!).getHours()]++
    if (e.status !== 'ok') continue
    w.okCount++
    if (e.hasCode) w.codeCount++
    if (e.taskType) w.taskCounts[e.taskType] = (w.taskCounts[e.taskType] ?? 0) + 1
  }
  // 대화 수·긴 대화 수
  const convsByWeek = new Map<number, Set<string>>()
  for (const e of all) { const ws = weekStart(e.createdAt!); convsByWeek.set(ws, (convsByWeek.get(ws) ?? new Set()).add(e.conversationId)) }
  for (const [ws, convs] of convsByWeek) {
    const w = weeks.get(ws)!
    w.conversationCount = convs.size
    w.longConversationCount = [...convs].filter((c) => (okPerConv.get(c) ?? 0) >= 10).length
  }
  return [...weeks.values()].sort((a, b) => a.periodStart - b.periodStart)
}

// 대장 병합: 같은 key는 새 항목으로 덮어쓴다(같은 기간 재전송 = 덮어쓰기)
export function mergeLedger(existing: LedgerEntry[], incoming: LedgerEntry[]): LedgerEntry[] {
  const m = new Map(existing.map((e) => [e.key, e]))
  for (const e of incoming) m.set(e.key, e)
  return [...m.values()]
}

export const conversationsOf = (entries: LedgerEntry[]) => new Set(entries.map((e) => e.conversationId)).size

// 전후 비교: 주별 스냅샷을 "이전"(앞쪽 주들)과 "이후"로 나눠 대화 종류 비중과 대화 습관(대화당 메시지, 긴 대화 비율)을 나란히 놓는다.
// 원인은 판정하지 않는다. ponytail: 여러 주에 걸친 대화는 주마다 한 번씩 센다(대화 수가 조금 부풀 수 있음).
export interface TaskCompareRow {
  task: string
  before: { ok: number; share: number | null }
  after: { ok: number; share: number | null }
  shareDelta: number | null // 그 종류가 전체 메시지에서 차지한 비중(%)의 변화(퍼센트포인트)
}
export interface Habits { ok: number; conversations: number; avgTurns: number | null; longShare: number | null } // longShare는 %
export interface TaskCompare {
  beforeRange: [number, number] | null // [첫 주 시작, 마지막 주 끝)
  afterRange: [number, number] | null
  rows: TaskCompareRow[]
  habits: { before: Habits; after: Habits }
}

export function compareTasks(weeks: PeriodSnapshot[], recentWeeks = 2, minSamples = 5): TaskCompare {
  const sorted = [...weeks].sort((a, b) => a.periodStart - b.periodStart)
  const cut = Math.max(0, sorted.length - recentWeeks)
  return compareSides(sorted.slice(0, cut), sorted.slice(cut), minSamples)
}

// 두 묶음(예: 예전 결과 파일의 주들 vs 지금 분석의 주들)을 그대로 이전/이후로 놓고 비교
export function compareSides(before: PeriodSnapshot[], after: PeriodSnapshot[], minSamples = 5): TaskCompare {
  const sum = (ws: PeriodSnapshot[]) => {
    const ok: Record<string, number> = {}
    let okAll = 0, convs = 0, long = 0
    for (const w of ws) {
      // 예전 분석(8가지 키)의 주가 섞여도 6가지로 합쳐 센다
      for (const [t0, n] of Object.entries(w.taskCounts)) { const t = foldTask(t0); ok[t] = (ok[t] ?? 0) + n; okAll += n }
      convs += w.conversationCount; long += w.longConversationCount
    }
    const habits: Habits = { ok: okAll, conversations: convs, avgTurns: convs ? okAll / convs : null, longShare: convs >= minSamples ? (100 * long) / convs : null }
    return { ok, okAll, habits }
  }
  const b = sum(before), a = sum(after)
  const share = (ok: number, all: number) => ({ ok, share: all >= minSamples ? (100 * ok) / all : null })
  const tasks = [...new Set([...Object.keys(b.ok), ...Object.keys(a.ok)])].sort((x, y) => (a.ok[y] ?? 0) + (b.ok[y] ?? 0) - ((a.ok[x] ?? 0) + (b.ok[x] ?? 0)))
  const rows = tasks.map((task): TaskCompareRow => {
    const bs = share(b.ok[task] ?? 0, b.okAll), as = share(a.ok[task] ?? 0, a.okAll)
    return { task, before: bs, after: as, shareDelta: bs.share != null && as.share != null ? as.share - bs.share : null }
  })
  const range = (ws: PeriodSnapshot[]): [number, number] | null => (ws.length ? [ws[0].periodStart, ws[ws.length - 1].periodEnd] : null)
  return { beforeRange: range(before), afterRange: range(after), rows, habits: { before: b.habits, after: a.habits } }
}
// 대화 습관 한 줄: "대화당 메시지 5.2 → 4.1개 · 긴 대화 30% → 22%". 좋고 나쁨은 판정하지 않는다
export const habitText = (b: Habits, a: Habits) =>
  `대화당 메시지 ${b.avgTurns?.toFixed(1) ?? '-'} → ${a.avgTurns?.toFixed(1) ?? '-'}개 · 긴 대화 ${b.longShare?.toFixed(0) ?? '-'}% → ${a.longShare?.toFixed(0) ?? '-'}%`
export type { Conversation }
