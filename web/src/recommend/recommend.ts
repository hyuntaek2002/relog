import catalog from '../../../catalog/catalog.json' with { type: 'json' }
import { SNAPSHOT_LABEL, type SnapshotTask, type UsageSnapshot } from './snapshot.ts'

// 처방 엔진. 순수 함수: (snapshot, context, catalog, feedback) → Prescription[]. 원문 없음, LLM 호출 없음.
export const RECOMMENDATION_RULE_VERSION = 'rec-0.2.0' // 0.2.0: 다시 말한 지시 신호 제거, 숫자 근거가 없는 항목은 '기본 추천'(참고)으로
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
  byTask?: Partial<Record<SnapshotTask, string>> // 대화 종류별 구체 항목 이름(howTo의 {plugin}에 치환)
  requiresTool?: 'claude_code' | 'codex' // 이 도구를 쓰는 사람에게만(featuresInUse의 'tool:<이름>'으로 판단, catalog-0.5.0)
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
  summary: string // 한 줄 요약(숫자 1~2개). 카드 머리말
  why: string // 근거 숫자 전체(펼침)
  what: string
  how: string
  caveat: string
  signalsUsed: string[]
  score: number
  pluginName?: string // 플러그인 카드가 가리키는 구체 플러그인 이름(howTo의 {plugin}에 넣은 값). '이미 설치됨' 표시용
  task?: SnapshotTask // 이 카드가 겨냥한 대화 종류(다음 분석 때 그 종류의 변화로 효과를 본다). 없으면 전체
}

export interface ScoredItem {
  item: CatalogItem
  score: number
  problemHits: string[]
  taskHits: string[]
  excluded: string | null // 필터 탈락 사유
}

const TASK_LABEL = SNAPSHOT_LABEL
const SIGNAL_LABEL: Record<string, string> = {
  conversationCount: '대화 수',
  longConversationShare: '긴 대화 비율',
  avgTurnsPerConversation: '대화당 평균 발화',
  codeShare: '코드 포함 비율',
  'answer.avgTokens': '평균 답변 분량',
  'answer.ratio': '답변이 내 메시지보다 긴 배수',
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
  if (path === 'answer.avgTokens') return `${label} ${Math.round(v)}토큰`
  if (path === 'answer.ratio') return `${label} ${v.toFixed(1)}배`
  return `${label} ${Math.round(v)}개`
}

// 2) 점수: 문제 신호 weight×2 + 과업 신호 weight + priority/100 + 피드백 보정
export function scoreAll(snapshot: UsageSnapshot, ctx: UserContext, feedback: FeedbackMap = {}, items: CatalogItem[] = CATALOG): ScoredItem[] {
  const inUse = new Set([...ctx.featuresInUse, ...Object.entries(feedback).filter(([, f]) => f === 'already_using').map(([id]) => id)])
  return items.map((item) => {
    let excluded: string | null = null
    if (!item.verified) excluded = '미검증'
    else if (item.platform !== 'both' && item.platform !== snapshot.platform) excluded = '플랫폼 불일치'
    else if (item.requiresTool && !ctx.featuresInUse.includes(`tool:${item.requiresTool}`)) excluded = '도구 미사용'
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

// 카드 머리말: 가장 강한 신호 하나를 쉬운 문장으로. 숫자는 1~2개만.
function summaryOf(snapshot: UsageSnapshot, s: ScoredItem): string {
  const hit = (prefix: string) => s.problemHits.find((h) => h.startsWith(prefix))
  if (hit('긴 대화 비율')) return `대화 ${Math.round(snapshot.longConversationShare * 100)}%가 메시지 10개를 넘는 긴 대화입니다.`
  if (hit('대화당 평균 발화')) return `대화 하나에 내 메시지가 평균 ${snapshot.avgTurnsPerConversation.toFixed(1)}개 오갑니다.`
  if (hit('대화 수')) return `대화를 ${snapshot.conversationCount}개 열었습니다. 새 대화마다 다시 적는 설정은 한 번만 정해 두면 됩니다.`
  if (hit('평균 답변 분량') || hit('답변이 내 메시지보다')) return `AI 답변이 평균 ${Math.round(snapshot.answer.avgTokens)}토큰으로 내 메시지의 ${snapshot.answer.ratio.toFixed(0)}배입니다.`
  if (hit('코드 포함 비율')) return `내 메시지의 ${Math.round(snapshot.codeShare * 100)}%에 코드가 들어 있습니다.`
  const top = (Object.entries(snapshot.taskShare) as [SnapshotTask, number][]).sort((a, b) => b[1] - a[1])[0]
  if (s.taskHits.length && top && top[1] > 0) return `${TASK_LABEL[top[0]]} 대화가 ${Math.round(top[1] * 100)}%로 가장 많습니다.`
  return '기록과 상관없이 누구에게나 권하는 기본 항목입니다.'
}

function why(snapshot: UsageSnapshot, s: ScoredItem): string {
  const parts: string[] = []
  const top = (Object.entries(snapshot.taskShare) as [SnapshotTask, number][]).sort((a, b) => b[1] - a[1])[0]
  if (s.taskHits.length) parts.push(s.taskHits.join(', ') + '으로 과업 비중이 큼')
  else if (top && top[1] > 0) parts.push(`${TASK_LABEL[top[0]]} ${Math.round(top[1] * 100)}%가 가장 많음`)
  if (s.problemHits.length) parts.push(s.problemHits.join(', '))
  if (!s.taskHits.length && !s.problemHits.length) parts.push('기록의 숫자로 걸린 근거는 없고 기본으로 권하는 항목')
  return parts.join('. ') + '.'
}

// howTo의 {plugin} 자리에 가장 많이 한 대화 종류의 항목 이름을 넣는다.
// catalog-0.3.2: byTask는 '대화 종류별 플러그인' 카드(taskPlugins·plugin-candidates)의 첫 후보와 같게 맞춤
function fillHow(item: CatalogItem, snapshot: UsageSnapshot): { how: string; pluginName?: string; task?: SnapshotTask } {
  if (!item.howTo30s.includes('{plugin}')) return { how: item.howTo30s }
  const desc = (o: Partial<Record<SnapshotTask, number>>) => (Object.entries(o) as [SnapshotTask, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]
  const top = desc(snapshot.taskShare)
  const name = (top && item.byTask?.[top[0]]) || undefined
  return { how: item.howTo30s.replaceAll('{plugin}', name ?? '내 작업에 맞는 플러그인'), pluginName: name, task: name ? top[0] : undefined }
}

// 카드가 겨냥한 대화 종류: {plugin}으로 고른 종류, 아니면 과업 신호가 걸린 종류 중 비중이 가장 큰 것
function targetTask(item: CatalogItem, snapshot: UsageSnapshot, filled?: SnapshotTask): SnapshotTask | undefined {
  if (filled) return filled
  return item.taskSignals.filter((ts) => (snapshot.taskShare[ts.task] ?? 0) >= ts.minShare).sort((a, b) => (snapshot.taskShare[b.task] ?? 0) - (snapshot.taskShare[a.task] ?? 0))[0]?.task
}

// 숫자 신호가 아예 없는 항목(누구에게나 맞는 습관·설정)은 '기본 추천'으로 우선순위 점수만 받는다(rec-0.2.0)
export const isBaseline = (item: CatalogItem) => item.problemSignals.length === 0 && item.taskSignals.length === 0

// 3)·4) 점수 > 0, 상위 3개, category당 최대 2개
export function recommend(snapshot: UsageSnapshot, ctx: UserContext, feedback: FeedbackMap = {}, items: CatalogItem[] = CATALOG): Prescription[] {
  const scored = scoreAll(snapshot, ctx, feedback, items)
    .filter((s) => !s.excluded && s.score > 0 && (s.problemHits.length > 0 || s.taskHits.length > 0 || isBaseline(s.item)))
    .sort((a, b) => b.score - a.score)
  const out: Prescription[] = []
  const perCategory = new Map<Category, number>()
  for (const s of scored) {
    if (out.length >= 3) break
    const n = perCategory.get(s.item.category) ?? 0
    if (n >= 2) continue
    perCategory.set(s.item.category, n + 1)
    const filled = fillHow(s.item, snapshot)
    out.push({
      catalogId: s.item.id,
      name: s.item.name,
      category: s.item.category,
      grade: s.problemHits.length > 0 ? '핵심' : '참고',
      summary: summaryOf(snapshot, s),
      why: why(snapshot, s),
      what: s.item.oneLiner,
      ...filled,
      task: targetTask(s.item, snapshot, filled.task),
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
