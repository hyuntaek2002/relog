import { normalizeConversations, normalizeStats, NORMALIZER_VERSION } from '../parser/normalize'
import { basicStats } from '../parser/stats'
import { PARSER_VERSION } from '../parser/chatgpt'
import { summarize, DETECTOR_VERSION, type Candidate } from '../detect/detector'
import { CLASSIFIER_VERSION, type Prediction, type TaskType } from '../classify/classifier'
import type { Conversation, Turn } from '../parser/types'
import type { AnalysisRecord } from '../store/records'

// 개발 확인용 예시 화면(?demo=1, ?demo=claude). 개발 서버에서만 켜지고 배포판에는 꺼진다.
// 대화·문장은 모두 지어낸 예시이고, 임베딩·모델 없이 분류·탐지 결과를 정해 둔다. 서버로는 아무것도 보내지 않는다.
export const DEMO: 'chatgpt' | 'claude' | null = (() => {
  if (!import.meta.env.DEV) return null
  const v = new URLSearchParams(location.search).get('demo')
  return v == null ? null : v === 'claude' ? 'claude' : 'chatgpt'
})()

const DAY = 86400000
const WEEKS = 12
// 종류별 주당 대화 수(코딩·업무 문서가 많고 번역은 드묾). 뒤쪽 주로 갈수록 코딩이 늘게 해 비중 변화가 보이게 한다.
const PER_WEEK: [TaskType, number][] = [['coding', 3], ['work_doc', 2], ['writing', 1], ['learning', 1], ['ideation', 1], ['search', 1], ['chat', 1], ['translation', 0.3]]
const WORD: Record<TaskType, string> = { coding: '로그인 화면 코드', work_doc: '주간 보고서', writing: '안내 글', learning: '자료구조 개념', ideation: '동아리 행사 기획', search: '노트북 사양 비교', chat: '진로 고민', translation: '영문 메일' }

export function demoData(platform: 'chatgpt' | 'claude') {
  const end = Date.now() - DAY
  const start = end - WEEKS * 7 * DAY
  const convs: Conversation[] = []
  const typeOf = new Map<string, TaskType>()
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let w = 0; w < WEEKS; w++) {
    for (const [task, n0] of PER_WEEK) {
      const n = task === 'coding' && w >= WEEKS / 2 ? n0 + 2 : n0
      const count = Math.floor(n) + (rnd() < n % 1 ? 1 : 0)
      for (let k = 0; k < count; k++) {
        const id = `demo-${w}-${task}-${k}`
        const t0 = start + w * 7 * DAY + Math.floor(rnd() * 6 * DAY)
        const turns: Turn[] = []
        const users = 3 + Math.floor(rnd() * 4)
        for (let i = 0; i < users; i++) {
          const at = t0 + i * 5 * 60000
          turns.push({ idx: turns.length, role: 'user', text: `[예시] ${WORD[task]} 관련 요청 ${i + 1}번입니다. 조건을 지켜서 다시 정리해 주세요.`, createdAt: at, messageId: `${id}-u${i}`, tokenEstimate: 30, hasAttachment: false })
          turns.push({ idx: turns.length, role: 'assistant', text: `[예시] ${WORD[task]} 답변 ${i + 1}`, createdAt: at + 60000, messageId: `${id}-a${i}`, tokenEstimate: 200, hasAttachment: false })
        }
        convs.push({ id, platform, title: `[예시] ${WORD[task]}`, createdAt: t0, turns, toolNames: [] })
        typeOf.set(id, task)
      }
    }
  }
  const utterances = normalizeConversations(convs)
  const ok = utterances.filter((u) => u.status === 'ok')
  const preds: Prediction[] = ok.map((u) => ({ type: typeOf.get(u.conversationId)!, score: 0.8 }))

  // 다시 말한 지시: 코딩·업무 문서 대화의 세 번째 요청 일부를 '확실함'으로. 앞쪽 주에 더 많이 둬서 줄어든 변화가 보이게 한다.
  const pairs: Candidate[] = []
  for (const u of ok) {
    const task = typeOf.get(u.conversationId)!
    const week = Math.floor(((u.createdAt ?? start) - start) / (7 * DAY))
    const p = (task === 'coding' ? 0.5 : task === 'work_doc' ? 0.35 : 0.08) * (week < WEEKS / 2 ? 1 : 0.4)
    if (!u.messageId.endsWith('-u2') || rnd() > p) continue
    pairs.push({ conversationId: u.conversationId, messageId: u.messageId, priorMessageId: u.messageId.replace(/-u2$/, '-u0'), similarity: 0.93, kind: 'instruction', repeatMarker: rnd() < 0.4, complaintMarker: rnd() < 0.2, gapMinutes: 10, responseBetween: true, grade: 'high', exclusion: null, tokenEstimate: u.tokenEstimate })
  }
  const inputs = ok.map((u) => ({ conversationId: u.conversationId, messageId: u.messageId, idx: u.idx, createdAt: u.createdAt, text: u.text, tokenEstimate: u.tokenEstimate, hasAttachment: u.hasAttachment, prevAssistantIdx: u.prevAssistantIdx }))

  const result = {
    type: 'result' as const, files: ['demo/conversations.json'], conversations: convs, errors: [], stats: basicStats(convs), utterances, codexPlugins: [],
    normStats: normalizeStats(utterances), parserVersion: PARSER_VERSION, normalizerVersion: NORMALIZER_VERSION, net: [],
  }
  const cls = {
    type: 'classified' as const, centroid: preds, knn: preds, linear: preds, embeddings: new Float32Array(0), dim: 0, embedMs: 0,
    candidates: pairs, pairs, sims: pairs.map((c) => c.similarity), nullSims: [], detectSummary: summarize(pairs, inputs, 0.85),
    modelVersion: 'demo', classifierVersion: CLASSIFIER_VERSION, detectorVersion: DETECTOR_VERSION, net: [],
  }
  // 변화 탭용 지난 기록: 기간 가운데에서 한 번 분석했고, 그때 몇 항목을 '적용함'으로 표시했다고 둔다
  const mid = start + (WEEKS / 2) * 7 * DAY - DAY
  const before = new Set(ok.filter((u) => (u.createdAt ?? 0) <= mid).map((u) => u.messageId))
  const prev: AnalysisRecord = {
    savedAt: mid + DAY / 2, platform, firstAt: start, lastAt: mid, versionKey: 'demo', judgeable: before.size, high: pairs.filter((c) => before.has(c.messageId)).length, tokenEstimate: 0,
    rx: [], plugins: [platform === 'claude' ? 'Engineering' : 'GitHub'],
    applied: ['prompt:coding', platform === 'claude' ? 'Engineering' : 'GitHub'],
    tasks: { 'prompt:coding': 'coding', [platform === 'claude' ? 'Engineering' : 'GitHub']: 'coding' },
  }
  return { result, cls, prev }
}
