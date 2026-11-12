import { useEffect, useState, type DragEvent } from 'react'
import type { WorkerIn, WorkerOut } from './worker/analyze.worker'
import type { EmbedOut } from './worker/embed.worker'
import { TASK_LABELS, TASK_TYPES, type Method, type Prediction } from './classify/classifier'
import Labeler from './dev/Labeler'
import PairLabeler from './dev/PairLabeler'
import Checklist, { loadContext, saveContext, withDetected } from './recommend/Checklist'
import { detectFeatures } from './recommend/detectFeatures'
import Prescriptions, { loadFeedback, saveFeedback } from './recommend/Prescriptions'
import AbMode from './recommend/AbMode'
import RecommendDev from './recommend/RecommendDev'
import TaskPlugins from './recommend/TaskPlugins'
import PluginSearch from './recommend/PluginSearch'
import { installedPlugins, TASK_PLUGIN_MIN_MESSAGES } from './recommend/taskPluginRules'
import Help from './ui/Help'
import { buildSnapshot } from './recommend/snapshot'
import { pinCodeToCoding, subByConversation } from './classify/codingSub'
import { CATALOG_VERSION, RECOMMENDATION_RULE_VERSION, recommend, type Feedback, type FeedbackMap, type Platform, type Prescription, type UserContext } from './recommend/recommend'
import Trend, { CompareTable, ReportFile, StorageChoice, loadStorageMode, STORAGE_MODE_KEY, type StorageMode } from './store/Trend'
import SyncPanel from './store/SyncPanel'
import { getToken, sendFeedback } from './store/sync'
import { applyDismissed, loadDismissed, saveDismissed } from './detect/corrections'
import { aggregateWeekly, buildLedger, versionKey, type AnalysisVersion, type LedgerEntry, type PeriodSnapshot, type TaskCompare } from './store/ledger'
import { clearAll, getLedger, putLedger } from './store/db'
import { peekAuditRecords, setAuditProbes, type NetRecord } from './worker/netaudit'

type Result = Extract<WorkerOut, { type: 'result' }>
type Classified = Extract<EmbedOut, { type: 'classified' }>
type Step = 'idle' | 'read' | 'analyze' | 'model' | 'classify' | 'done'

const STEPS: [Step, string][] = [['read', '파일 읽기'], ['analyze', '정리'], ['model', '모델 준비'], ['classify', '분석'], ['done', '완료']]
const MODELS = ['Xenova/multilingual-e5-small', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', 'static-e5'] as const
const DEFAULT_MODEL = MODELS[0]
const DEVICE: 'wasm' | 'webgpu' = 'gpu' in navigator ? 'webgpu' : 'wasm'
const DEV = new URLSearchParams(location.search).has('dev')
const AB = new URLSearchParams(location.search).has('ab')

// 화면 용어: 등급은 내부 high/medium/low, 사용자에겐 확실함/가능성 있음/약함
const GRADE_LABEL = { high: '확실함', medium: '가능성 있음', low: '약함' } as const
// 탐지기가 후보에서 뺀 이유(detector.ts exclusion) → 쉬운 말
const EXCLUSION_LABEL: Record<string, string> = { below_null: '기준 미만', generic: '범용 문구(응, 계속 등)', resend: '몇 분 안 재전송', routine: '같은 명령 다시 내림(커밋하세요 등)', user_dismissed: '내가 반복 아님으로 고침', not_instruction: '지시문 아님', chat_task: '잡담', attachment: '첨부 있음', stale: '하루 넘게 지남' }

const fmtDate = (ms: number | null) => (ms == null ? '-' : new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }))

// 네트워크 감사 표: 요청 전수와 "원문 포함" 판정. 통과 조건 = 원문 포함 0건, 본문 있는 요청은 모델 CDN 범위 밖이면 의심.
function NetAudit({ records }: { records: NetRecord[] }) {
  const hosts = new Map<string, number>()
  for (const r of records) { let h = ''; try { h = new URL(r.url, location.href).host } catch { h = '?' } hosts.set(h, (hosts.get(h) ?? 0) + 1) }
  const leaks = records.filter((r) => r.containsText)
  const withBody = records.filter((r) => r.bodyBytes > 0)
  return (
    <div>
      <p className={leaks.length ? 'err' : 'detail'}>
        요청 {records.length}건 · 본문 있는 요청 {withBody.length}건 · <b>원문 포함 {leaks.length}건</b> {leaks.length === 0 ? '→ 통과' : '→ 실패'} · 호스트: {[...hosts].map(([h, n]) => `${h} ${n}`).join(', ') || '없음'}
      </p>
      {records.length > 0 && (
        <table className="dev">
          <thead><tr><th>컨텍스트</th><th>메서드</th><th>URL</th><th>본문(B)</th><th>원문</th></tr></thead>
          <tbody>
            {records.slice(-60).map((r, i) => (
              <tr key={i} className={r.containsText ? 'err' : ''}><td>{r.context}</td><td>{r.method}</td><td>{r.url.replace(/^https?:\/\//, '').slice(0, 90)}</td><td>{r.bodyBytes}</td><td>{r.containsText ? '포함' : ''}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0
}

function countByType(preds: Prediction[]) {
  const c = new Map<string, number>()
  for (const p of preds) c.set(p.type, (c.get(p.type) ?? 0) + 1)
  return [...TASK_TYPES, 'other'].map((t) => ({ type: t, label: t === 'other' ? '기타' : TASK_LABELS[t as keyof typeof TASK_LABELS], n: c.get(t) ?? 0 })).sort((a, b) => b.n - a.n)
}

export default function App() {
  const [step, setStep] = useState<Step>('idle')
  const [detail, setDetail] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [cls, setCls] = useState<Classified | null>(null)
  const [method, setMethod] = useState<Method>('linear') // 제품 기본은 D(선형). 개발 패널에서 B·C와 바꿔 볼 수 있다
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)
  const [embedLog, setEmbedLog] = useState<string[]>([])
  const [ctx, setCtx] = useState<UserContext | null>(null)
  const [feedback, setFeedback] = useState<FeedbackMap>(loadFeedback)
  const [storageMode, setStorageMode] = useState<StorageMode>(loadStorageMode)
  const [ledger, setLedger] = useState<LedgerEntry[]>([]) // 보관 모드면 IndexedDB 전체, 아니면 이번 분석분만
  const [weeks, setWeeks] = useState<PeriodSnapshot[]>([])
  const [version, setVersion] = useState<AnalysisVersion | null>(null) // 이번 분석의 AnalysisVersion(결과 파일에 함께 넣음)
  const [net, setNet] = useState<NetRecord[]>([]) // 네트워크 감사 기록(페이지 + 워커)
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed) // 내가 "반복 아님"으로 고친 메시지 id
  const [serverRx, setServerRx] = useState<Prescription[] | null>(null) // 서버가 계산한 추천(동기화했을 때만)
  const [serverTrend, setServerTrend] = useState<(TaskCompare & { weeks: number }) | null>(null) // 서버 보관 집계로 계산한 변화

  // 보관 모드면 시작할 때 저장된 대장을 불러와 추이를 보여준다
  useEffect(() => {
    if (storageMode !== 'local') return
    getLedger().then((rows) => { setLedger(rows); if (rows.length) setWeeks(aggregateWeekly(rows, rows[rows.length - 1].versionKey)) }).catch(() => {})
  }, [storageMode])

  function onStorageMode(m: StorageMode) {
    setStorageMode(m)
    try { localStorage.setItem(STORAGE_MODE_KEY, m) } catch { /* 무시 */ }
  }
  async function onClear() {
    if (!confirm('이 브라우저에 저장된 분석 데이터, 설정, 피드백, 라벨링 진행 상황을 모두 지웁니다. 계속할까요?')) return
    await clearAll()
    setLedger([]); setWeeks([]); setFeedback({}); setStorageMode('none')
  }

  async function onFile(list: FileList | File[] | null | undefined) {
    const files = [...(list ?? [])].filter((f) => /\.zip$/i.test(f.name))
    if (files.length === 0) return
    setError(''); setResult(null); setCls(null); setEmbedLog([]); setStep('read'); setDetail(''); setCtx(null); setNet([])
    const w = new Worker(new URL('./worker/analyze.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'progress') setStep(m.stage === 'unzip' ? 'read' : 'analyze')
      else if (m.type === 'result') { setResult(m); setServerRx(null); setServerTrend(null); setCtx(loadContext(m.conversations[0]?.platform ?? 'chatgpt')); setAuditProbes(m.utterances.map((u) => u.text)); setNet((n) => [...n, ...m.net]); w.terminate(); classify(m) }
      else { setError(m.message); setStep('idle'); w.terminate() }
    }
    w.postMessage({ type: 'parse', files } satisfies WorkerIn)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); setOver(false)
    onFile(e.dataTransfer.files)
  }

  // 정규화된 ok 발화 전체를 임베딩하고 과업 유형을 예측한다. 전부 브라우저 안에서.
  function classify(r: Result) {
    const ok = r.utterances.filter((u) => u.status === 'ok')
    const texts = ok.map((u) => u.text)
    if (texts.length === 0) { setStep('done'); return }
    const clientOf = new Map(r.conversations.map((c) => [c.id, c.client ?? 'app'])) // 기준선 묶음: 앱 / Claude Code
    const inputs = ok.map((u) => ({ conversationId: u.conversationId, messageId: u.messageId, idx: u.idx, createdAt: u.createdAt, text: u.text, tokenEstimate: u.tokenEstimate, hasAttachment: u.hasAttachment, prevAssistantIdx: u.prevAssistantIdx, group: clientOf.get(u.conversationId) ?? 'app' }))
    setStep('model')
    const w = new Worker(new URL('./worker/embed.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<EmbedOut>) => {
      const m = e.data
      if (m.type === 'download') { setStep('model'); setDetail(`${m.file.split('/').pop()} ${m.percent}%`) }
      else if (m.type === 'progress') { setStep('classify'); setDetail(`${m.done} / ${m.total}`) }
      else if (m.type === 'classified') { m.knn = pinCodeToCoding(m.knn, ok, r.conversations); m.centroid = pinCodeToCoding(m.centroid, ok, r.conversations); m.linear = pinCodeToCoding(m.linear, ok, r.conversations); setCls(m); setStep('done'); setDetail(''); record(r, m, dismissed); w.terminate(); setNet((n) => [...n, ...m.net]); if (DEV) { measureMemory('분석 완료 직후'); Object.assign(window, { __relog: { result: r, cls: m } }) } } // 개발 모드: 콘솔에서 숫자 집계용(원문은 화면 밖으로 안 나감) // 임베딩·모델 메모리 회수
      else if (m.type === 'error') { setError(m.message); setStep('done'); w.terminate() }
    }
    w.postMessage({ type: 'classify', model: DEFAULT_MODEL, device: DEVICE, texts, inputs })
  }

  // 발화 대장 갱신 → 주 단위 집계. 보관 모드면 IndexedDB에 병합(같은 키는 덮어쓰기)하고 전체 대장으로 재계산.
  // dismissedIds: 내가 "반복 아님"으로 고친 메시지. 주별 집계에도 반영되도록 대장을 만들 때 등급을 뗀다.
  async function record(r: Result, m: Classified, dismissedIds: string[]) {
    const version = { parserVersion: r.parserVersion, normalizerVersion: r.normalizerVersion, modelVersion: m.modelVersion, classifierVersion: m.classifierVersion, detectorVersion: m.detectorVersion, catalogVersion: CATALOG_VERSION, recommendationRuleVersion: RECOMMENDATION_RULE_VERSION }
    const entries = buildLedger({ platform: r.conversations[0]?.platform ?? 'chatgpt', utterances: r.utterances, okIds: r.utterances.filter((u) => u.status === 'ok').map((u) => u.messageId), preds: m.linear, pairs: applyDismissed(m.pairs, m.detectSummary, dismissedIds).pairs, version })
    let all = entries
    if (storageMode === 'local') {
      try { await putLedger(entries); all = await getLedger() } catch (e) { setError('로컬 보관 실패: ' + (e as Error).message) }
    }
    setLedger(all)
    setWeeks(aggregateWeekly(all, versionKey(version)))
    setVersion(version)
  }

  // 메모리 실측(개발용). crossOriginIsolated일 때 워커까지 포함한 값, 아니면 메인 스레드 JS 힙만.
  async function measureMemory(tag: string) {
    const perf = performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number; breakdown: { bytes: number; attribution: { url?: string; scope?: string }[]; types: string[] }[] }>; memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }
    const mb = (b: number) => (b / 1048576).toFixed(1) + 'MB'
    const lines = [`[메모리 ${tag}] crossOriginIsolated=${crossOriginIsolated}`]
    if (perf.memory) lines.push(`  main JS heap used ${mb(perf.memory.usedJSHeapSize)} / total ${mb(perf.memory.totalJSHeapSize)}`)
    if (perf.measureUserAgentSpecificMemory) {
      try {
        const r = await perf.measureUserAgentSpecificMemory()
        lines.push(`  agent total ${mb(r.bytes)}`)
        for (const b of r.breakdown) if (b.bytes > 1048576) lines.push(`    ${mb(b.bytes)} ${b.types.join('+')} ${b.attribution.map((a) => (a.scope ?? '') + ' ' + (a.url ?? '').split('/').slice(-1)[0]).join(',')}`)
      } catch (e) { lines.push('  measureUserAgentSpecificMemory 실패: ' + (e as Error).message) }
    } else lines.push('  measureUserAgentSpecificMemory 없음')
    setEmbedLog((l) => [...l, ...lines])
  }

  function runEmbed(model: string, device: 'wasm' | 'webgpu') {
    if (!result) return
    const all = result.utterances.filter((u) => u.status === 'ok').map((u) => u.text)
    // 속도 측정용으로 정확히 100개. 부족하면 순환해서 채운다.
    const texts = Array.from({ length: 100 }, (_, i) => all[i % all.length])
    const w = new Worker(new URL('./worker/embed.worker.ts', import.meta.url), { type: 'module' })
    const tag = `${model} / ${device}`
    setEmbedLog((l) => [...l, `${tag}: 시작 (${texts.length}개, 평균 ${Math.round(texts.reduce((a, t) => a + t.length, 0) / texts.length)}자)`])
    w.onmessage = (e: MessageEvent<EmbedOut>) => {
      const m = e.data
      if (m.type === 'download') setEmbedLog((l) => [...l.slice(0, -1), `${tag}: 다운로드 ${m.file} ${m.percent}%`])
      else if (m.type === 'progress') setEmbedLog((l) => [...l.slice(0, -1), `${tag}: 임베딩 ${m.done}/${m.total}`])
      else if (m.type === 'done') setEmbedLog((l) => [...l, `${tag}: 로드 ${m.loadMs}ms, 임베딩 ${m.count}개 ${m.embedMs}ms (${(m.embedMs / m.count).toFixed(1)}ms/개), dim=${m.dim}`])
      else if (m.type === 'error') setEmbedLog((l) => [...l, `${tag}: 오류 ${m.message}`])
    }
    w.postMessage({ type: 'embed', model, device, texts })
  }

  const [tab, setTab] = useState<'restate' | 'rx' | 'trend'>('restate') // 결과 화면 탭: 다시 말한 지시 / 추천 / 변화
  const s = result?.stats
  const n = result?.normStats
  const stepIdx = STEPS.findIndex(([k]) => k === step)
  const textById = new Map(result?.utterances.map((u) => [u.messageId, u.text]))
  const titleById = new Map(result?.conversations.map((c) => [c.id, c.title]))
  const textOf = (id: string) => (textById.get(id) ?? '').slice(0, 400)
  const titleOf = (id: string) => titleById.get(id) || '(제목 없음)'
  const preds = cls ? cls[method] : null
  const byType = preds ? countByType(preds) : null
  const agree = cls ? cls.linear.filter((p, i) => p.type === cls.centroid[i].type).length / cls.linear.length : 0

  // 추천: 집계 숫자(snapshot) + 체크리스트(ctx) + 로컬 피드백만 입력. 원문 없음.
  const platform: Platform = result?.conversations[0]?.platform ?? 'chatgpt'  // 탐지 결과에 내 보정("반복 아님")을 적용한 것. 화면의 건수·비율·추천 입력은 전부 이 값을 쓴다.
  const eff = cls ? applyDismissed(cls.pairs, cls.detectSummary, dismissed) : null
  function setDismissedIds(next: string[]) {
    setDismissed(next); saveDismissed(next); setServerRx(null)
    if (result && cls) record(result, cls, next)
  }
  const snapshot = result && cls && s && eff
    ? buildSnapshot({ platform, stats: s, utterances: result.utterances, okIds: result.utterances.filter((u) => u.status === 'ok').map((u) => u.messageId), preds: cls.linear, candidates: eff.candidates, detect: eff.summary, subByConversation: subByConversation(result.conversations) })
    : null
  const detected = result ? detectFeatures(result.conversations) : []
  const installed = result ? installedPlugins(result.conversations) : [] // Claude Code 기록의 설치 플러그인 id
  const prescriptions = snapshot && ctx ? recommend(snapshot, withDetected(ctx, detected), feedback) : []
  function onFeedback(id: string, f: Feedback) {
    const next = { ...feedback, [id]: f }
    setFeedback(next); saveFeedback(next)
    if (getToken()) sendFeedback(id, f).catch(() => {}) // 서버 동기화를 쓰는 중이면 피드백도 서버에 남긴다(추천 우선순위 조정용)
  }
  function onCtx(c: UserContext) { setCtx(c); saveContext(platform, c); setServerRx(null) }
  const shownRx = serverRx ?? prescriptions

  const flagged = eff ? eff.candidates : []
  const codeConvIds = new Set((result?.conversations ?? []).filter((c) => c.client === 'code').map((c) => c.id)) // 개발 패널: 다시 말한 지시 출처 나눔
  // 대화별로 묶는다. 확실함만 본 목록에 두고, 가능성 있음(실제 정밀도 0.13)은 접힌 '참고' 목록에만(det-0.4.1).
  // '약함'은 같은 주제의 후속 발화가 많이 섞여 개발 모드에서만 참고 목록에 넣는다.
  const gradeRank = { high: 0, medium: 1, low: 2 } as const
  const groupBy = (cs: typeof flagged) => [...cs.reduce((m, c) => m.set(c.conversationId, [...(m.get(c.conversationId) ?? []), c]), new Map<string, typeof flagged>())]
    .map(([id, items]) => ({ id, items: items.sort((a, b) => gradeRank[a.grade ?? 'low'] - gradeRank[b.grade ?? 'low'] || b.similarity - a.similarity) }))
    .sort((a, b) => b.items.length - a.items.length)
  const groups = groupBy(flagged.filter((c) => c.grade === 'high'))
  const refItems = flagged.filter((c) => c.grade === 'medium' || (DEV && c.grade === 'low'))
  const refGroups = groupBy(refItems)
  const renderGroup = (g: (typeof groups)[number]) => (
    // 대화별로 묶어 제목·건수만. 펼치면 그 대화의 건들이, 건을 또 펼치면 앞/뒤 메시지가 보인다(원문은 이 화면에만).
    <details className="conv" key={g.id}>
      <summary><b>{titleOf(g.id)}</b><span>{g.items.length}건</span></summary>
      {g.items.map((c) => (
        <details className="cand" key={c.messageId}>
          <summary className="meta">
            <span className={`grade-${c.grade}`}>{GRADE_LABEL[c.grade ?? 'low']}</span>
            <span>{textOf(c.messageId).slice(0, 40).replace(/\s+/g, ' ')}{textOf(c.messageId).length > 40 ? '…' : ''}</span>
            {c.repeatMarker && <span>"아까 말했" 같은 표현</span>}
            {c.complaintMarker && <span>답답함 표현</span>}
            {c.gapMinutes != null && <span>{c.gapMinutes < 60 ? `${Math.round(c.gapMinutes)}분 뒤` : `${Math.round(c.gapMinutes / 60)}시간 뒤`}</span>}
          </summary>
          <p className="detail">앞 메시지와 비슷한 정도 {c.similarity.toFixed(2)}{!c.responseBetween && ' · 사이에 AI 답이 없음'}</p>
          <blockquote>{textOf(c.priorMessageId)}</blockquote>
          <blockquote className="now">{textOf(c.messageId)}</blockquote>
          <p className="actions"><button title="다시 말한 것이 아니면 눌러 주세요. 목록에서 빠지고, 확실함이면 건수와 비율, 추천에서도 빠집니다." onClick={() => setDismissedIds([...dismissed, c.messageId])}>반복 아님</button></p>
        </details>
      ))}
    </details>
  )

  return (
    <main>
      <h1>relog</h1>
      <p className="sub">이 브라우저 안에서만 분석합니다. 대화 내용은 어디로도 보내지 않습니다.</p>

      <label
        className={'drop' + (over ? ' over' : '') + (result ? ' small' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input type="file" accept=".zip" multiple onChange={(e) => onFile(e.target.files)} />
        {result ? '다른 파일 분석' : 'ChatGPT·Claude 내보내기 zip을 끌어다 놓거나 클릭'}
      </label>
      {!result && <p className="detail">Claude Code 기록(.claude 폴더 안의 projects 폴더를 zip으로 묶은 것)도 같이 넣을 수 있습니다.</p>}

      {step !== 'idle' && step !== 'done' && ( // 진행 막대는 분석 중에만
        <>
          <ol className="steps">
            {STEPS.map(([k, label], i) => (
              <li key={k} className={i < stepIdx ? 'done' : i === stepIdx ? 'active' : ''}>{label}</li>
            ))}
          </ol>
          {detail && <p className="detail">{detail}</p>}
        </>
      )}
      {error && <p className="err">{error}</p>}

      {!result && (
        <section>
          <StorageChoice mode={storageMode} storedCount={ledger.length} onMode={onStorageMode} onClear={onClear} />
          {weeks.length > 0 && (
            <>
              <p className="label">저장된 변화</p>
              <Trend weeks={weeks} />
            </>
          )}
        </section>
      )}

      {result && s && n && (
        <section>
          <p className="strip">대화 <b>{s.conversations}</b> · 내 메시지 <b>{s.userTurns}</b> · 긴 대화 <b>{s.longConversations}</b> · {fmtDate(s.firstAt)} ~ {fmtDate(s.lastAt)}</p>
          <nav className="tabs">
            <button className={tab === 'restate' ? 'on' : ''} onClick={() => setTab('restate')}>다시 말한 지시{eff && <em>{eff.summary.byGrade.high}</em>}</button>
            <button className={tab === 'rx' ? 'on' : ''} onClick={() => setTab('rx')}>{AB ? '추천 평가' : '추천'}{shownRx.length > 0 && <em>{shownRx.length}</em>}</button>
            <button className={tab === 'trend' ? 'on' : ''} onClick={() => setTab('trend')}>변화</button>
          </nav>

          {/* 넓은 화면(900px 이상): 탭 없이 왼쪽 다시 말한 지시, 오른쪽 추천·변화를 나란히. 좁은 화면: 탭으로 하나씩 */}
          <div className="layout">
          <div className={'panel' + (tab === 'restate' ? ' on' : '')}>
          <p className="label wide">다시 말한 지시</p>
          {cls && eff ? (
            <>
              <div className="cards three">
                <div className="card">
                  <b>{eff.summary.byGrade.high}</b>
                  <span>다시 말한 지시<Help text="같은 대화에서 앞서 한 지시를 다시 말한 것이 확실해 보이는 메시지입니다. AI가 지시를 따랐는지는 판정하지 않습니다. 내용은 이 화면에만 보입니다." /></span>
                  <small>확실함만 셉니다. 참고: 가능성 있음 {eff.summary.byGrade.medium} · 약함 {eff.summary.byGrade.low}</small>
                </div>
                <div className="card"><b>{eff.summary.ratio.toFixed(1)}%</b><span>비교한 내 메시지 {eff.summary.judgeable}개 중</span></div>
                <div className="card"><b>{eff.summary.tokenEstimate.toLocaleString()}</b><span>다시 친 분량 (토큰, 추정)</span></div>
              </div>
              {eff.dismissedCount > 0 && <p className="detail">내가 반복 아님으로 고친 것 {eff.dismissedCount}건은 뺐습니다. <button onClick={() => setDismissedIds([])}>모두 되돌리기</button></p>}
              {groups.length === 0 && <p className="detail">확실함으로 잡힌 메시지가 없습니다.</p>}
              {groups.map(renderGroup)}
              {refGroups.length > 0 && (
                <details className="ref">
                  <summary>참고: 가능성 있음 {refItems.length}건<Help text="앞 메시지와 비슷하지만 다시 말했다는 표현이 없는 메시지입니다. 실제 기록으로 확인했을 때 30건 중 4건만 다시 말한 지시였습니다. 그래서 건수·비율·추천에는 넣지 않고 여기에만 보여 줍니다." /></summary>
                  {refGroups.map(renderGroup)}
                </details>
              )}
            </>
          ) : <p className="detail">분석 중입니다.</p>}
          </div>

          <div className="side">
          <div className={'panel' + (tab === 'rx' ? ' on' : '')}>
          <p className="label wide">{AB ? '추천 평가' : '추천'}</p>
          {snapshot && ctx && (
            <>
              {AB ? <AbMode platform={platform} personalized={prescriptions} snapshot={snapshot} weeks={weeks} version={version} ctx={withDetected(ctx, detected)} /> : <Prescriptions items={shownRx} feedback={feedback} onFeedback={onFeedback} installed={installed} />}
              {!AB && (
                <>
                  <p className="label">대화 종류별 플러그인<Help text={`많이 쓴 대화 종류 순입니다. 그 종류 메시지가 ${TASK_PLUGIN_MIN_MESSAGES}개 이상일 때만 플러그인을 권합니다. ${platform === 'claude' ? 'Claude Code 기록의 메시지는 모두 코딩으로 셉니다. ' : ''}효과는 아직 검증되지 않았습니다.`} /></p>
                  <TaskPlugins snapshot={snapshot} installed={installed} platform={platform} />
                  {platform === 'claude' && <PluginSearch installed={installed} />}
                </>
              )}
            </>
          )}

          </div>

          <div className={'panel' + (tab === 'trend' ? ' on' : '')}>
          <p className="label wide">변화</p>
          <Trend weeks={weeks} />
          {serverTrend && (
            <>
              <p className="label">서버 보관 기준 ({serverTrend.weeks}주)</p>
              <CompareTable cmp={serverTrend} before="이전" after="최근" />
            </>
          )}
          {snapshot && version && <ReportFile snapshot={snapshot} weeks={weeks} version={version} />}
          </div>
          </div>
          </div>

          <div className="more">
            {ctx && (
              <details>
                <summary>내 설정</summary>
                <Checklist platform={platform} value={ctx} detected={detected} onChange={onCtx} />
              </details>
            )}
            <details>
              <summary>서버 동기화 (선택)</summary>
              <SyncPanel weeks={weeks} version={version} snapshot={snapshot} ctx={ctx ? withDetected(ctx, detected) : null} onServer={(r) => { setServerRx(r.prescriptions); setServerTrend(r.trend) }} />
            </details>
            <details>
              <summary>보관 · 자세한 숫자</summary>
              <StorageChoice mode={storageMode} storedCount={storageMode === 'local' ? ledger.length : 0} onMode={onStorageMode} onClear={onClear} />
              {byType && preds && (
                <>
                  <p className="label">대화 종류 비율<Help text={`내 메시지 ${preds.length}개 기준. 종류는 자동 추정이라 틀릴 수 있습니다.`} /></p>
                  <ul className="bars">
                    {byType.filter((t) => t.n > 0).map((t) => (
                      <li key={t.type}>
                        <span>{t.label}</span>
                        <i style={{ width: `${(100 * t.n) / preds.length}%` }} />
                        <em>{Math.round((100 * t.n) / preds.length)}%</em>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="label">자세한 숫자</p>
              <table>
                <tbody>
                  <tr><td>읽은 파일</td><td>{result.files.join(', ')}</td></tr>
                  <tr><td>AI 답변 수</td><td>{s.assistantTurns}</td></tr>
                  <tr><td>비교한 내 메시지 (메시지 2개 이상인 대화)</td><td>{s.judgeableUserTurns}</td></tr>
                  <tr><td>내 메시지 분량 (토큰, 추정)</td><td>{s.userTokenEstimate.toLocaleString()}</td></tr>
                  <tr><td>AI 답변 분량 (토큰, 추정) · 답변 하나 평균 · 내 메시지 대비</td><td>{s.assistantTokenEstimate.toLocaleString()} · {s.assistantTurns ? Math.round(s.assistantTokenEstimate / s.assistantTurns) : 0} · {s.userTokenEstimate ? (s.assistantTokenEstimate / s.userTokenEstimate).toFixed(1) : '0'}배</td></tr>
                  {cls && <tr><td>비슷한 질문 다시 함 · 말이 안 통한 듯한 표현</td><td>{cls.detectSummary.repeatedQuestions} · {cls.detectSummary.misunderstanding}</td></tr>}
                  <tr><td>분석에서 뺀 메시지 (응, 계속 등)</td><td>{n.skipped}</td></tr>
                  <tr><td>앞뒤 문맥이 있어야 뜻을 아는 짧은 메시지</td><td>{n.context_required}</td></tr>
                  <tr><td>코드가 포함된 메시지</td><td>{n.hasCode}</td></tr>
                  <tr><td>읽지 못한 대화</td><td>{result.errors.length}</td></tr>
                  <tr><td>버전</td><td>{result.parserVersion}, {result.normalizerVersion}{cls && `, ${cls.modelVersion}, ${cls.classifierVersion}, ${cls.detectorVersion}`}, {CATALOG_VERSION}, {RECOMMENDATION_RULE_VERSION}</td></tr>
                </tbody>
              </table>
              {result.errors.length > 0 && <pre>{JSON.stringify(result.errors.slice(0, 20), null, 2)}</pre>}
            </details>
          </div>

          {DEV && (
            <details className="devbox">
              <summary>개발자 패널 (?dev=1)</summary>
              <p className="detail">주소에 ?dev=1을 붙였을 때만 보이는 영역입니다. 탐지·분류가 얼마나 맞는지 정답을 모으고(라벨링), 원문이 밖으로 나가지 않는지·메모리와 속도가 괜찮은지 재는 데 씁니다. 일반 사용자에게는 보이지 않습니다.</p>
              {snapshot && ctx && (
                <>
                  <h2>개발: 추천 점수표</h2>
                  <RecommendDev snapshot={snapshot} ctx={withDetected(ctx, detected)} feedback={feedback} />
                </>
              )}
              {cls && (
                <>
                  <h2>개발: 다시 말한 지시 정답 찍기 (비슷한 정도 상위 100쌍)</h2>
                  <p className="detail">탐지기가 "앞 메시지와 비슷하다"고 본 쌍을 비슷한 정도가 높은 순으로 100쌍 보여 줍니다. 위 회색 글이 앞 메시지, 아래가 다시 말한 것으로 의심되는 메시지입니다. 사람이 정답을 찍어 두면 탐지가 얼마나 맞는지(정밀도)를 eval/detect/eval_pairs.mjs로 계산할 수 있습니다. 같은 대화에서 여러 쌍이 나오면 그 대화가 여러 번 보입니다. CSV에는 대화·메시지 번호, 비슷한 정도, 정답만 들어가고 본문은 없습니다.</p>
                  <PairLabeler pairs={cls.pairs} utterances={result.utterances} conversations={result.conversations} />
                </>
              )}
              <h2>개발: 대화 종류 정답 찍기</h2>
              <p className="detail">내 메시지 하나하나가 어떤 종류(코딩·글쓰기 등)인지 사람이 정답을 찍는 화면입니다. 정답이 쌓이면 자동 분류 A/B/C 세 방식 중 무엇이 가장 잘 맞는지 eval/classify/run_abc.mjs로 비교합니다. 목표 400개.</p>
              <Labeler utterances={result.utterances} conversations={result.conversations} />
              <h2>개발: 분류·탐지 내부 숫자</h2>
              <p className="detail">비슷한 정도는 0~1이고 1에 가까울수록 앞 메시지와 같은 말입니다. 기준선은 "같은 대화 안에서 서로 떨어진 메시지끼리 보통 얼마나 비슷한가"이고, 그보다 높아야 다시 말한 지시로 봅니다. 뺀 메시지는 기준에 걸려 후보에서 제외된 수입니다.</p>
              {cls && (
                <p className="detail">
                  비슷한 정도 분포(비교한 내 메시지 {cls.sims.length}개): {[0.5, 0.75, 0.9, 0.95, 0.98].map((q) => `p${q * 100}=${quantile(cls.sims, q).toFixed(3)}`).join(' ')}
                  <br />기준선(같은 대화 안 떨어진 쌍 {cls.nullSims.length}개): {[0.5, 0.9, 0.95, 0.99].map((q) => `p${q * 100}=${quantile(cls.nullSims, q).toFixed(3)}`).join(' ')} → 기준 {cls.detectSummary.nullThreshold.toFixed(3)}, 기준 넘는 메시지 {cls.sims.filter((s) => s >= cls.detectSummary.nullThreshold).length}개
                  <br />묶음별 기준(같은 대화 안 떨어진 쌍의 p90): {Object.entries(cls.detectSummary.groupThreshold).map(([g, t]) => `${g === 'code' ? 'Claude Code' : '앱'} ${t.toFixed(3)}`).join(' · ') || '없음(전체 기준 사용)'}
                  <br />뺀 메시지: {Object.entries(cls.detectSummary.excluded).map(([k, v]) => `${EXCLUSION_LABEL[k] ?? k} ${v}`).join(' · ')}
                  <br />다시 말한 지시(확실함+가능성 있음) 출처: 앱 {cls.candidates.filter((c) => (c.grade === 'high' || c.grade === 'medium') && !codeConvIds.has(c.conversationId)).length} · Claude Code {cls.candidates.filter((c) => (c.grade === 'high' || c.grade === 'medium') && codeConvIds.has(c.conversationId)).length}
                </p>
              )}
              {cls && (
                <p>
                  대화 종류 분류 방식: <button onClick={() => setMethod('linear')} disabled={method === 'linear'}>D 학습한 분류기</button>
                  <button onClick={() => setMethod('knn')} disabled={method === 'knn'}>C 가까운 예시 투표</button>
                  <button onClick={() => setMethod('centroid')} disabled={method === 'centroid'}>B 종류별 평균과 비교</button>
                  B와 D가 같은 답을 낸 비율 {Math.round(agree * 100)}%, 문장을 숫자로 바꾸는 데 {cls.embedMs}ms ({(cls.embedMs / cls.knn.length).toFixed(0)}ms/개), 계산 장치 {DEVICE}
                </p>
              )}
              <h2>개발: 네트워크 감사</h2>
              <p className="detail">분석하는 동안 이 페이지가 밖으로 보낸 요청 전부입니다. 모델 파일을 내려받는 요청만 있어야 하고, 본문을 실어 보낸 요청이 0건이어야 통과입니다. "원문 포함"은 요청 본문에 내 메시지 글귀가 들어 있는지 직접 대조한 결과입니다.</p>
              <NetAudit records={[...net, ...peekAuditRecords()]} />
              <h2>개발: 메모리</h2>
              <p className="detail">이 탭이 쓰는 메모리입니다. 분석 중 모델을 올렸다가 끝나면 내리는데, 내린 뒤 메모리가 돌아오는지 보려고 둔 버튼입니다. 브라우저 제약으로 주 화면(JS heap)만 재고, 모델을 돌린 작업 스레드는 포함되지 않습니다.</p>
              <p><button onClick={() => measureMemory('수동')}>지금 측정</button></p>
              <h2>개발: 모델별 속도 (내 메시지 100개)</h2>
              <p className="detail">문장을 숫자로 바꾸는 모델 세 가지를 wasm(CPU)과 webgpu(그래픽카드)로 각각 돌려 100개 처리 시간을 잽니다. 어느 모델·장치를 기본으로 쓸지 정하려고 둔 버튼입니다.</p>
              {MODELS.map((m) => (
                <p key={m}>{m}: <button onClick={() => runEmbed(m, 'wasm')}>wasm</button><button onClick={() => runEmbed(m, 'webgpu')}>webgpu</button></p>
              ))}
              <pre>{embedLog.join('\n')}</pre>
            </details>
          )}
        </section>
      )}
    </main>
  )
}
