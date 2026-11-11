import type { AnalysisVersion, PeriodSnapshot, TaskCompare } from './ledger'
import type { Feedback, Prescription, UserContext } from '../recommend/recommend'
import type { UsageSnapshot } from '../recommend/snapshot'

// 서버 동기화 클라이언트(선택 기능). 보내는 것은 주별 집계 숫자·추천 엔진 입력 숫자·체크리스트·피드백뿐이다.
// 대화 내용·임베딩·플랫폼 계정 정보를 담을 필드가 없다. 서버 주소는 빌드 시 VITE_API_BASE, 기본은 로컬 개발 서버.
export const API_BASE: string = (import.meta.env?.VITE_API_BASE as string | undefined) ?? 'http://localhost:8080'
const TOKEN_KEY = 'relog-token'

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
const setToken = (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY) } catch { /* 무시 */ } }

async function call<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) }
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`
  let r: Response
  try { r = await fetch(API_BASE + path, { ...init, headers }) } catch { throw new Error('서버에 연결하지 못했습니다') }
  if (r.status === 401) { if (auth) setToken(null); throw new Error(auth ? '로그인이 필요합니다' : '이메일이나 비밀번호가 맞지 않습니다') }
  const body = r.status === 204 ? null : await r.json().catch(() => null)
  if (!r.ok) throw new Error((body && body.error) || `서버 오류 ${r.status}`)
  return body as T
}

export async function register(email: string, password: string) {
  const { token } = await call<{ token: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }, false)
  setToken(token)
}
export async function login(email: string, password: string) {
  const { token } = await call<{ token: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false)
  setToken(token)
}
export const logout = () => setToken(null)

// PeriodSnapshot → 서버 DTO. 키는 서버 열거형과 같다(coding|writing|learning|work_doc|search|ideation|translation|chat|other).
export function toDto(w: PeriodSnapshot, version: AnalysisVersion) {
  return {
    platform: w.platform,
    periodStart: w.periodStart,
    periodEnd: w.periodEnd,
    analysisVersion: version,
    userTurnCount: w.userTurnCount,
    okCount: w.okCount,
    judgeable: w.judgeable,
    conversationCount: w.conversationCount,
    longConversationCount: w.longConversationCount,
    codeCount: w.codeCount,
    taskCounts: w.taskCounts,
    hourHistogram: w.hourHistogram,
    restatement: {
      high: w.restatement.high, medium: w.restatement.medium, low: w.restatement.low,
      tokenEstimate: w.restatement.tokenEstimate, ratio: Math.min(100, Math.max(0, w.restatement.ratio)),
      repeatedQuestion: w.restatement.repeatedQuestion, misunderstanding: w.restatement.misunderstanding, perTask: w.restatement.perTask,
    },
  }
}

// 추천 요청 본문: 추천 엔진 입력 숫자 + 체크리스트. 서버 RecommendController.Request 와 1:1.
export function toRecommendRequest(s: UsageSnapshot, ctx: UserContext) {
  return {
    platform: s.platform,
    taskShare: s.taskShare,
    userTurnCount: s.userTurnCount,
    conversationCount: s.conversationCount,
    longConversationShare: Math.min(1, s.longConversationShare),
    avgTurnsPerConversation: s.avgTurnsPerConversation,
    codeShare: Math.min(1, s.codeShare),
    restatement: { high: s.restatement.high, mid: s.restatement.mid, low: s.restatement.low, misunderstanding: s.restatement.misunderstanding, repeatedQuestion: s.restatement.repeatedQuestion, perTask: s.restatement.perTask, tokenEstimate: s.restatement.tokenEstimate, ratio: Math.min(100, Math.max(0, s.restatement.ratio)) },
    answer: { avgTokens: s.answer.avgTokens, ratio: s.answer.ratio },
    plan: ctx.plan,
    featuresInUse: ctx.featuresInUse,
    mode: 'personalized',
  }
}

export const upsertSnapshots = (weeks: PeriodSnapshot[], version: AnalysisVersion) =>
  call<{ created: number; updated: number }>('/api/snapshots', { method: 'PUT', body: JSON.stringify(weeks.map((w) => toDto(w, version))) })

// 서버가 계산한 추천(계획서: 활용 전략 추천의 처리 위치는 서버). 서버는 이 처방을 이력으로 남긴다.
export const fetchRecommendations = (s: UsageSnapshot, ctx: UserContext) =>
  call<{ prescriptions: Prescription[]; message?: string; ruleVersion: string; catalogVersion: string }>('/api/recommendations', { method: 'POST', body: JSON.stringify(toRecommendRequest(s, ctx)) })

export interface StoredPrescription { catalogId: string; name: string; category: string; grade: string; summary: string | null; what: string; how: string; caveat: string; score: number }
export const latestRecommendations = () => call<{ createdAt?: string; prescriptions: StoredPrescription[] }>('/api/recommendations')

// 서버가 보관한 주별 집계로 계산한 변화 추이(이전 기간 vs 최근 recentWeeks주)
export const fetchTrend = (recentWeeks = 2) => call<TaskCompare & { weeks: number; versionKey: string | null }>(`/api/trend?recentWeeks=${recentWeeks}`)

export type ServerWeek = ReturnType<typeof toDto> & { versionKey: string; updatedAt: string }
export const listSnapshots = () => call<ServerWeek[]>('/api/snapshots')

export const sendFeedback = (catalogId: string, value: Feedback | 'ab_score', extra: { source?: string; abScore?: number; abOrder?: number } = {}) =>
  call<{ saved: number }>('/api/feedback', { method: 'POST', body: JSON.stringify([{ catalogId, value, ...extra }]) })

export const me = () => call<{ email: string; createdAt: string; snapshots: number }>('/api/me')
export const deleteMe = async () => { await call<{ deleted: boolean }>('/api/me', { method: 'DELETE' }); setToken(null) }
