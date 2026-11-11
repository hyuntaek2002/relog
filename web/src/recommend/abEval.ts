import type { CatalogItem, Prescription } from './recommend.ts'
import type { Report } from '../store/report.ts'

// 추천 블라인드 평가(계획서 표 7): 일반 추천(인기 기능)과 개인화 추천을 섞어 무작위 순서로 보여 주고 관련성 1~5점을 받는다.
// 관련성 선호(평가 파일)와 실제 사용 여부(1주 뒤 후속 파일)를 따로 모은다. 두 파일 모두 숫자·식별자뿐이고 대화 내용은 없다.
export const EVAL_FORMAT = 'relog-eval-1'
export const FOLLOWUP_FORMAT = 'relog-eval-followup-1'
export type EvalSource = 'generic' | 'personalized' | 'both'
export const SOURCE_LABEL: Record<EvalSource, string> = { generic: '일반 추천', personalized: '개인화 추천', both: '둘 다에 있음' }

export interface EvalCard { catalogId: string; name: string; what: string; how: string; source: EvalSource; order: number }

// 결정적 섞기(LCG). 같은 seed면 같은 순서 → 점수를 매기는 동안 순서가 바뀌지 않는다.
export function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs]
  let s = seed >>> 0
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 두 목록을 합쳐 카드로. 양쪽에 다 있는 항목은 한 장(both). 카드 겉모습은 출처와 무관하게 같다(이름·한 줄·사용법만, 개인 수치 없음).
export function buildCards(generic: CatalogItem[], personalized: Prescription[], seed: number): EvalCard[] {
  const map = new Map<string, EvalCard>()
  const neutral = (how: string) => how.split('{plugin}').join('내 작업에 맞는 플러그인')
  for (const g of generic) map.set(g.id, { catalogId: g.id, name: g.name, what: g.oneLiner, how: neutral(g.howTo30s), source: 'generic', order: 0 })
  for (const p of personalized) {
    const prev = map.get(p.catalogId)
    if (prev) prev.source = 'both'
    else map.set(p.catalogId, { catalogId: p.catalogId, name: p.name, what: p.what, how: p.how, source: 'personalized', order: 0 })
  }
  return shuffle([...map.values()], seed).map((c, i) => ({ ...c, order: i + 1 }))
}

export interface EvalFile {
  format: typeof EVAL_FORMAT
  participant: string // 참여자 번호(이름·연락처 아님)
  exportedAt: string
  platform: string
  plan: string
  featuresInUse: string[]
  cards: { catalogId: string; source: EvalSource; score: number; order: number }[]
  report: Report | null // 주 단위 집계 숫자(동의서 3항). 없으면 null
}

export function buildEvalFile(a: { participant: string; platform: string; plan: string; featuresInUse: string[]; cards: EvalCard[]; scores: Record<string, number>; report: Report | null; now?: Date }): EvalFile {
  return {
    format: EVAL_FORMAT,
    participant: a.participant.trim(),
    exportedAt: (a.now ?? new Date()).toISOString(),
    platform: a.platform,
    plan: a.plan,
    featuresInUse: a.featuresInUse,
    cards: a.cards.map((c) => ({ catalogId: c.catalogId, source: c.source, score: a.scores[c.catalogId], order: c.order })),
    report: a.report,
  }
}

export interface FollowupFile {
  format: typeof FOLLOWUP_FORMAT
  participant: string
  exportedAt: string
  evaluatedAt: string // 원래 평가 파일의 exportedAt
  items: { catalogId: string; source: EvalSource; used: boolean }[]
}

const isSource = (s: unknown): s is EvalSource => s === 'generic' || s === 'personalized' || s === 'both'

export function parseEvalFile(text: string): EvalFile {
  let o: unknown
  try { o = JSON.parse(text) } catch { throw new Error('JSON 파일이 아닙니다') }
  const f = o as Partial<EvalFile>
  if (!f || f.format !== EVAL_FORMAT) throw new Error('relog 평가 파일이 아닙니다')
  if (!f.participant || !Array.isArray(f.cards) || f.cards.length === 0) throw new Error('참여자 번호나 카드가 없는 파일입니다')
  if (!f.cards.every((c) => typeof c.catalogId === 'string' && isSource(c.source) && Number.isInteger(c.score) && c.score >= 1 && c.score <= 5)) throw new Error('점수가 빠졌거나 손상된 파일입니다')
  return f as EvalFile
}

export function parseFollowupFile(text: string): FollowupFile {
  let o: unknown
  try { o = JSON.parse(text) } catch { throw new Error('JSON 파일이 아닙니다') }
  const f = o as Partial<FollowupFile>
  if (!f || f.format !== FOLLOWUP_FORMAT || !f.participant || !Array.isArray(f.items)) throw new Error('relog 후속 파일이 아닙니다')
  if (!f.items.every((i) => typeof i.catalogId === 'string' && isSource(i.source) && typeof i.used === 'boolean')) throw new Error('손상된 후속 파일입니다')
  return f as FollowupFile
}

// 양측 정확 부호 검정: 개인화 > 일반인 참여자 a명, 반대 b명(동점 제외)일 때의 p값
export function signTestP(a: number, b: number): number {
  const n = a + b
  if (n === 0) return 1
  const k = Math.min(a, b)
  let c = 1, sum = 0 // C(n, i)
  for (let i = 0; i <= k; i++) { sum += c; c = (c * (n - i)) / (i + 1) }
  return Math.min(1, (2 * sum) / 2 ** n)
}

export interface EvalSummary {
  participants: number
  perParticipant: { participant: string; generic: number | null; personalized: number | null; both: number | null; diff: number | null }[]
  meanGeneric: number | null
  meanPersonalized: number | null
  preferPersonalized: number
  preferGeneric: number
  ties: number
  signTestP: number
  usage: Record<EvalSource, { used: number; total: number }>
}

// 참여자별로 출처별 평균 점수를 내고(양쪽에 다 있는 카드는 비교에서 빼고 따로 보고), 어느 쪽이 높았는지 센다.
export function summarizeEval(files: EvalFile[], followups: FollowupFile[] = []): EvalSummary {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : null)
  const perParticipant = files.map((f) => {
    const by = (s: EvalSource) => mean(f.cards.filter((c) => c.source === s).map((c) => c.score))
    const generic = by('generic'), personalized = by('personalized')
    return { participant: f.participant, generic, personalized, both: by('both'), diff: generic != null && personalized != null ? personalized - generic : null }
  })
  const diffs = perParticipant.map((p) => p.diff).filter((d): d is number => d != null)
  const preferPersonalized = diffs.filter((d) => d > 0).length, preferGeneric = diffs.filter((d) => d < 0).length
  const usage: EvalSummary['usage'] = { generic: { used: 0, total: 0 }, personalized: { used: 0, total: 0 }, both: { used: 0, total: 0 } }
  for (const f of followups) for (const i of f.items) { usage[i.source].total++; if (i.used) usage[i.source].used++ }
  return {
    participants: files.length,
    perParticipant,
    meanGeneric: mean(perParticipant.map((p) => p.generic).filter((x): x is number => x != null)),
    meanPersonalized: mean(perParticipant.map((p) => p.personalized).filter((x): x is number => x != null)),
    preferPersonalized,
    preferGeneric,
    ties: diffs.filter((d) => d === 0).length,
    signTestP: signTestP(preferPersonalized, preferGeneric),
    usage,
  }
}
