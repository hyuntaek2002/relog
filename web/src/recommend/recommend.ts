import catalog from './catalog.json' with { type: 'json' }
import type { SnapshotTask, UsageSnapshot } from './snapshot.ts'

// 처방 엔진. 순수 함수: (snapshot, context, catalog, feedback) → Prescription[]. 원문 없음, LLM 호출 없음.
export const RECOMMENDATION_RULE_VERSION = 'rec-0.1.0'
export const CATALOG_VERSION = catalog.catalogVersion

export type Platform = 'chatgpt' | 'claude'
export type Category = 'feature' | 'plugin' | 'connector' | 'skill' | 'practice'
export interface ProblemSignal { signal: string; op: '>=' | '>' | '<=' | '<'; value: number; weight: number }
export interface TaskSignal { task: SnapshotTask; minShare: number; weight: number }
export interface CatalogItem {
  id: string
  platform: Platform | 'both'
  name: string
  category: Category
  oneLiner: string
  howTo30s: string
  requiresPlan: string[]
  hardExclude: { featuresInUse: string[] }
  problemSignals: ProblemSignal[]
  taskSignals: TaskSignal[]
  priority: number
  evidenceUrl: string
  verifiedAt: string
  verified: boolean
  isPopularDefault: boolean
  caveat: string
}
export const CATALOG = catalog.items as CatalogItem[]

export interface UserContext {
  plan: string
  featuresInUse: string[] // 자동 감지 + (있다면) 수동. 엔진은 이 목록만 본다
  goals?: string[]
  ignored?: string[] // 사용자가 "아니다"라고 해제한 감지 항목
}
export type Feedback = 'helpful' | 'not_helpful' | 'already_using'
export type FeedbackMap = Record<string, Feedback>

export interface Prescription {
  catalogId: string
  name: string
  category: Category
  grade: '핵심' | '참고'
  why: string
  what: string
  how: string
  caveat: string
  signalsUsed: string[]
  score: number
}

export interface ScoredItem {
  item: CatalogItem
  score: number
  problemHits: string[]
  taskHits: string[]
  excluded: string | null // 필터 탈락 사유
}

const TASK_LABEL: Record<SnapshotTask, string> = { coding: '코딩', writing: '글쓰기·교정', learning: '학습·설명', workdoc: '업무 문서', search: '정보 탐색', ideation: '아이디어·기획', translation: '번역', counseling: '상담·대화' }
const SIGNAL_LABEL: Record<string, string> = {
  'restatement.high': '반복 지시 의심(높음)',
  'restatement.mid': '반복 지시 의심(중간)',
  'restatement.low': '반복 지시 의심(낮음)',
  'restatement.misunderstanding': '이해 실패 의심',
  'restatement.repeatedQuestion': '반복 질문',
  longConversationShare: '긴 대화 비율',
  avgTurnsPerConversation: '대화당 평균 발화',
  codeShare: '코드 포함 비율',
}

// "restatement.high" 같은 점 경로를 snapshot에서 읽는다
export function readSignal(s: UsageSnapshot, path: string): number {
  let v: unknown = s
  for (const k of path.split('.')) v = v != null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined
  return typeof v === 'number' ? v : 0
}

const cmp = (a: number, op: ProblemSignal['op'], b: number) => (op === '>=' ? a >= b : op === '>' ? a > b : op === '<=' ? a <= b : a < b)
const fmtSignal = (path: string, v: number) => {
  const label = SIGNAL_LABEL[path] ?? path
  if (path === 'longConversationShare' || path === 'codeShare') return `${label} ${Math.round(v * 100)}%`
  if (path === 'avgTurnsPerConversation') return `${label} ${v.toFixed(1)}개`
  return `${label} ${Math.round(v)}건`
}

// 2) 점수: 문제 신호 weight×2 + 과업 신호 weight + priority/100 + 피드백 보정
export function scoreAll(snapshot: UsageSnapshot, ctx: UserContext, feedback: FeedbackMap = {}, items: CatalogItem[] = CATALOG): ScoredItem[] {
  const inUse = new Set([...ctx.featuresInUse, ...Object.entries(feedback).filter(([, f]) => f === 'already_using').map(([id]) => id)])
  return items.map((item) => {
    let excluded: string | null = null
    if (!item.verified) excluded = '미검증'
    else if (item.platform !== 'both' && item.platform !== snapshot.platform) excluded = '플랫폼 불일치'
    else if (item.requiresPlan.length && !item.requiresPlan.includes(ctx.plan)) excluded = `요금제 미지원(${item.requiresPlan.join('/')})`
    else if (inUse.has(item.id) || item.hardExclude.featuresInUse.some((f) => inUse.has(f))) excluded = '이미 사용 중'

    const problemHits: string[] = []
    let score = 0
    for (const ps of item.problemSignals) {
      const v = readSignal(snapshot, ps.signal)
      if (cmp(v, ps.op, ps.value)) { score += ps.weight * 2; problemHits.push(fmtSignal(ps.signal, v)) }
    }
    const taskHits: string[] = []
    for (const ts of item.taskSignals) {
      const share = snapshot.taskShare[ts.task] ?? 0
      if (share >= ts.minShare) { score += ts.weight; taskHits.push(`${TASK_LABEL[ts.task]} ${Math.round(share * 100)}%`) }
    }
    score += item.priority / 100
    const fb = feedback[item.id]
    if (fb === 'helpful') score += 1
    else if (fb === 'not_helpful') score -= 2
    // 문제 신호가 하나도 없으면 과업 신호만으로는 "참고"까지만. 점수도 과업 신호 합을 넘지 않게 둔다.
    return { item, score, problemHits, taskHits, excluded }
  })
}

function why(snapshot: UsageSnapshot, s: ScoredItem): string {
  const parts: string[] = []
  const top = (Object.entries(snapshot.taskShare) as [SnapshotTask, number][]).sort((a, b) => b[1] - a[1])[0]
  if (s.taskHits.length) parts.push(s.taskHits.join(', ') + '으로 과업 비중이 큼')
  else if (top && top[1] > 0) parts.push(`${TASK_LABEL[top[0]]} ${Math.round(top[1] * 100)}%가 가장 많음`)
  if (s.problemHits.length) parts.push(s.problemHits.join(', '))
  const r = snapshot.restatement
  const perTaskTop = (Object.entries(r.perTask) as [SnapshotTask, number][]).sort((a, b) => b[1] - a[1])[0]
  if (s.problemHits.some((h) => h.startsWith('반복 지시')) && perTaskTop && perTaskTop[1] > 0) parts.push(`반복 의심은 ${TASK_LABEL[perTaskTop[0]]}에 ${perTaskTop[1]}건으로 집중`)
  return parts.join('. ') + '.'
}

// 3)·4) 점수 > 0, 상위 3개, category당 최대 2개
export function recommend(snapshot: UsageSnapshot, ctx: UserContext, feedback: FeedbackMap = {}, items: CatalogItem[] = CATALOG): Prescription[] {
  const scored = scoreAll(snapshot, ctx, feedback, items)
    .filter((s) => !s.excluded && s.score > 0 && (s.problemHits.length > 0 || s.taskHits.length > 0))
    .sort((a, b) => b.score - a.score)
  const out: Prescription[] = []
  const perCategory = new Map<Category, number>()
  for (const s of scored) {
    if (out.length >= 3) break
    const n = perCategory.get(s.item.category) ?? 0
    if (n >= 2) continue
    perCategory.set(s.item.category, n + 1)
    out.push({
      catalogId: s.item.id,
      name: s.item.name,
      category: s.item.category,
      grade: s.problemHits.length > 0 ? '핵심' : '참고',
      why: why(snapshot, s),
      what: s.item.oneLiner,
      how: s.item.howTo30s,
      caveat: s.item.caveat,
      signalsUsed: [...s.problemHits, ...s.taskHits],
      score: Math.round(s.score * 100) / 100,
    })
  }
  return out
}

export const NO_RECOMMENDATION = '지금 데이터로는 추천할 항목이 없습니다. 분석 대화가 더 쌓이면 다시 시도하세요.'

// A/B: 플랫폼별 인기 기본 3개
export function genericDefaults(platform: Platform, items: CatalogItem[] = CATALOG): CatalogItem[] {
  return items.filter((i) => i.verified && i.isPopularDefault && (i.platform === platform || i.platform === 'both')).slice(0, 3)
}

export const PLANS: Record<Platform, { id: string; label: string }[]> = {
  chatgpt: [{ id: 'free', label: 'Free' }, { id: 'go', label: 'Go' }, { id: 'plus', label: 'Plus' }, { id: 'pro', label: 'Pro' }, { id: 'business', label: 'Business(구 Team)' }],
  claude: [{ id: 'free', label: 'Free' }, { id: 'pro', label: 'Pro' }, { id: 'max', label: 'Max' }, { id: 'team', label: 'Team' }],
}
export const GOALS = ['반복 줄이기', '긴 작업 관리', '비용 절약']
