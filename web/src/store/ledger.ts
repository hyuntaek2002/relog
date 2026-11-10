import type { Prediction } from '../classify/classifier.ts'
import type { Candidate } from '../detect/detector.ts'
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
  grade: Candidate['grade'] // 반복 의심 등급. 후보가 아니면 null
  exclusion: Candidate['exclusion']
  kind: Candidate['kind'] | null
  complaint: boolean
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
  pairs: Candidate[]
  version: AnalysisVersion
  analyzedAt?: number
}): LedgerEntry[] {
  const { platform, utterances, okIds, preds, pairs, version } = args
  const analyzedAt = args.analyzedAt ?? Date.now()
  const vk = versionKey(version)
  const typeById = new Map(okIds.map((id, i) => [id, preds[i]?.type ?? null]))
  const pairById = new Map(pairs.map((p) => [p.messageId, p]))
  return utterances.map((u) => {
    const p = pairById.get(u.messageId)
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
      grade: p?.grade ?? null,
      exclusion: p?.exclusion ?? null,
      kind: p?.kind ?? null,
      complaint: p?.complaintMarker ?? false,
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
  judgeable: number // 사용자 발화 2개 이상인 대화의 ok 발화
  conversationCount: number // 이 주에 발화가 있는 대화
  longConversationCount: number // 그중 전체 ok 발화 10개 이상
  codeCount: number
  taskCounts: Record<string, number>
  restatement: { high: number; medium: number; low: number; tokenEstimate: number; ratio: number; perTask: Record<string, number>; repeatedQuestion: number; misunderstanding: number }
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
      w = { periodStart: ws, periodEnd: ws + 7 * 86400000, versionKey: vk, platform: e.platform, userTurnCount: 0, okCount: 0, judgeable: 0, conversationCount: 0, longConversationCount: 0, codeCount: 0, taskCounts: {}, restatement: { high: 0, medium: 0, low: 0, tokenEstimate: 0, ratio: 0, perTask: {}, repeatedQuestion: 0, misunderstanding: 0 }, hourHistogram: new Array(24).fill(0) }
      weeks.set(ws, w)
    }
    w.userTurnCount++
    w.hourHistogram[new Date(e.createdAt!).getHours()]++
    if (e.status !== 'ok') continue
    w.okCount++
    if (e.hasCode) w.codeCount++
    if (e.taskType) w.taskCounts[e.taskType] = (w.taskCounts[e.taskType] ?? 0) + 1
    if ((okPerConv.get(e.conversationId) ?? 0) >= 2) w.judgeable++
    if (e.grade) {
      w.restatement[e.grade]++
      w.restatement.tokenEstimate += e.tokenEstimate
      if (e.taskType) w.restatement.perTask[e.taskType] = (w.restatement.perTask[e.taskType] ?? 0) + 1
    }
    if (e.kind === 'question' && e.exclusion === 'not_instruction') w.restatement.repeatedQuestion++
    if (e.complaint) w.restatement.misunderstanding++
  }
  // 대화 수·긴 대화 수
  const convsByWeek = new Map<number, Set<string>>()
  for (const e of all) { const ws = weekStart(e.createdAt!); convsByWeek.set(ws, (convsByWeek.get(ws) ?? new Set()).add(e.conversationId)) }
  for (const [ws, convs] of convsByWeek) {
    const w = weeks.get(ws)!
    w.conversationCount = convs.size
    w.longConversationCount = [...convs].filter((c) => (okPerConv.get(c) ?? 0) >= 10).length
    const flagged = w.restatement.high + w.restatement.medium + w.restatement.low
    w.restatement.ratio = w.judgeable ? (100 * flagged) / w.judgeable : 0
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

// 과업별 전후 비교: 주별 스냅샷을 "이전 기간"(앞쪽 주들)과 "최근 기간"(마지막 recentWeeks주)으로 나눠
// 과업 유형별 발화 수·반복 의심 수·비율을 나란히 놓는다. 모델 응답 이행 여부와 무관한 집계 숫자.
export interface TaskCompareRow {
  task: string
  before: { ok: number; flagged: number; ratio: number | null }
  after: { ok: number; flagged: number; ratio: number | null }
  delta: number | null // after.ratio - before.ratio (퍼센트포인트). 한쪽이라도 표본이 없으면 null
}
export interface TaskCompare {
  beforeRange: [number, number] | null // [첫 주 시작, 마지막 주 끝)
  afterRange: [number, number] | null
  rows: TaskCompareRow[]
  total: TaskCompareRow
}

export function compareTasks(weeks: PeriodSnapshot[], recentWeeks = 2, minSamples = 5): TaskCompare {
  const sorted = [...weeks].sort((a, b) => a.periodStart - b.periodStart)
  const cut = Math.max(0, sorted.length - recentWeeks)
  return compareSides(sorted.slice(0, cut), sorted.slice(cut), minSamples)
}

// 두 묶음(예: 예전 결과 파일의 주들 vs 지금 분석의 주들)을 그대로 이전/이후로 놓고 비교
export function compareSides(before: PeriodSnapshot[], after: PeriodSnapshot[], minSamples = 5): TaskCompare {
  const sum = (ws: PeriodSnapshot[]) => {
    const ok: Record<string, number> = {}, flagged: Record<string, number> = {}
    let okAll = 0, flaggedAll = 0
    for (const w of ws) {
      for (const [t, n] of Object.entries(w.taskCounts)) { ok[t] = (ok[t] ?? 0) + n; okAll += n }
      for (const [t, n] of Object.entries(w.restatement.perTask)) { flagged[t] = (flagged[t] ?? 0) + n }
      flaggedAll += w.restatement.high + w.restatement.medium + w.restatement.low
    }
    return { ok, flagged, okAll, flaggedAll }
  }
  const b = sum(before), a = sum(after)
  const side = (ok: number, flagged: number) => ({ ok, flagged, ratio: ok >= minSamples ? (100 * flagged) / ok : null })
  const tasks = [...new Set([...Object.keys(b.ok), ...Object.keys(a.ok)])].sort((x, y) => (a.ok[y] ?? 0) + (b.ok[y] ?? 0) - ((a.ok[x] ?? 0) + (b.ok[x] ?? 0)))
  const row = (task: string, bs: ReturnType<typeof side>, as: ReturnType<typeof side>): TaskCompareRow => ({ task, before: bs, after: as, delta: bs.ratio != null && as.ratio != null ? as.ratio - bs.ratio : null })
  const rows = tasks.map((t) => row(t, side(b.ok[t] ?? 0, b.flagged[t] ?? 0), side(a.ok[t] ?? 0, a.flagged[t] ?? 0)))
  const range = (ws: PeriodSnapshot[]): [number, number] | null => (ws.length ? [ws[0].periodStart, ws[ws.length - 1].periodEnd] : null)
  return { beforeRange: range(before), afterRange: range(after), rows, total: row('all', side(b.okAll, b.flaggedAll), side(a.okAll, a.flaggedAll)) }
}
export type { Conversation }
