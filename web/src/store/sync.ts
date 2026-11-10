import type { PeriodSnapshot } from './ledger'
import type { AnalysisVersion } from './ledger'
import type { Feedback } from '../recommend/recommend'

// 서버 동기화 클라이언트. 보내는 것은 주별 집계 숫자·체크리스트·피드백뿐이다.
// 서버 주소는 빌드 시 VITE_API_BASE, 기본은 로컬 개발 서버.
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8080'
const TOKEN_KEY = 'relog-token'

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
const setToken = (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* 무시 */ } }

async function call<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) }
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(API_BASE + path, { ...init, headers })
  if (r.status === 401) { setToken(null); throw new Error('로그인이 필요합니다') }
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

export const upsertSnapshots = (weeks: PeriodSnapshot[], version: AnalysisVersion) =>
  call<{ created: number; updated: number }>('/api/snapshots', { method: 'PUT', body: JSON.stringify(weeks.map((w) => toDto(w, version))) })

export const sendFeedback = (catalogId: string, value: Feedback | 'ab_score', extra: { source?: string; abScore?: number; abOrder?: number } = {}) =>
  call<{ saved: number }>('/api/feedback', { method: 'POST', body: JSON.stringify([{ catalogId, value, ...extra }]) })

export const me = () => call<{ email: string; createdAt: string; snapshots: number }>('/api/me')
export const deleteMe = async () => { await call<{ deleted: boolean }>('/api/me', { method: 'DELETE' }); setToken(null) }
