import { useEffect, useState, type DragEvent } from 'react'
import type { WorkerIn, WorkerOut } from './worker/analyze.worker'
import type { EmbedOut } from './worker/embed.worker'
import { TASK_LABELS, TASK_TYPES, type Method, type Prediction } from './classify/classifier'
import Labeler from './dev/Labeler'
import { DEMO, demoData } from './dev/demo'
import Checklist, { loadContext, saveContext, withDetected } from './recommend/Checklist'
import { detectFeatures } from './recommend/detectFeatures'
import Prescriptions, { loadFeedback, saveFeedback } from './recommend/Prescriptions'
import AbMode from './recommend/AbMode'
import RecommendDev from './recommend/RecommendDev'
import TaskPlugins from './recommend/TaskPlugins'
import PluginSearch from './recommend/PluginSearch'
import { codingSubPlugin, installedPlugins, poolTexts, resolveTaskPlugins, similarityScores, TASK_PLUGIN_MIN_MESSAGES } from './recommend/taskPluginRules'
import Help from './ui/Help'
import { buildSnapshot, SNAPSHOT_LABEL, TASK_MAP, type SnapshotTask } from './recommend/snapshot'
import { pinCodeToCoding, subByConversation, type CodingSub } from './classify/codingSub'
import { CATALOG_VERSION, RECOMMENDATION_RULE_VERSION, recommend, type Feedback, type FeedbackMap, type Platform, type Prescription, type UserContext } from './recommend/recommend'
import ExportGuide from './ExportGuide'
import { doneFraction, fmtRemaining, remainingMs } from './worker/eta'
import Trend, { ReportFile, StorageChoice, loadStorageMode, STORAGE_MODE_KEY, type StorageMode } from './store/Trend'
import SyncPanel from './store/SyncPanel'
import { deleteServerRecords, getToken, listFeedback, listServerRecords, putServerRecord, sendFeedback } from './store/sync'
import History from './store/History'
import { clearRecords, compareSince, loadRecords, previousRecords, promptKey, putRecord, putRecords, repeatNotes, type AnalysisRecord } from './store/records'
import { loadMarks, mergeServerMarks, saveMarks, toggleMark, usingKeys, type Mark, type Marks } from './store/marks'
import { aggregateWeekly, buildLedger, versionKey, type AnalysisVersion, type LedgerEntry, type PeriodSnapshot } from './store/ledger'
import { clearAll, getLedger, putLedger } from './store/db'
import { peekAuditRecords, setAuditProbes, type NetRecord } from './worker/netaudit'

type Result = Extract<WorkerOut, { type: 'result' }>
type Classified = Extract<EmbedOut, { type: 'classified' }>
type Step = 'idle' | 'read' | 'analyze' | 'model' | 'classify' | 'done'

const STEPS: [Step, string][] = [['read', '파일 읽기'], ['analyze', '정리'], ['model', '모델 준비'], ['classify', '분석'], ['done', '완료']]
// 첫 항목이 제품 기본. 2026-11-17 분류 성능을 우선해 e5-small → e5-large(약 560MB, 분석 시간 약 11배). 나머지는 개발 패널 속도 비교용
const MODELS = ['Xenova/multilingual-e5-large', 'Xenova/multilingual-e5-small', 'Xenova/multilingual-e5-base', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', 'static-e5'] as const
// 분석 방식: 정밀(e5-large, 기본) / 빠른(e5-small, 약 11배 빠름, 분류가 조금 덜 정확). 둘 다 같은 라벨 표본으로 학습한 분류 자료가 있다(labeledFor).
// 근거(docs/measurements.md 2026-11-17 "같은 대화 문맥 섞기"): 공개 표본 F1 0.655 vs 0.600, 본인 라벨 정확도 0.665 vs 0.641
const ANALYSIS_MODES = {
  precise: { model: 'Xenova/multilingual-e5-large', label: '정밀 분석', note: '모델 약 540MB · 메시지 수천 개면 1시간 넘게 걸릴 수 있음 · 대화 종류를 더 정확히 나눔' },
  quick: { model: 'Xenova/multilingual-e5-small', label: '빠른 분석', note: '모델 약 110MB · 정밀 분석보다 약 10배 빠름(메시지 수천 개면 5~10분) · 대화 종류 분류가 조금 덜 정확함' },
} as const
type AnalysisMode = keyof typeof ANALYSIS_MODES
const MODE_KEY = 'relog-analysis-mode'
const loadMode = (): AnalysisMode => { try { return localStorage.getItem(MODE_KEY) === 'quick' ? 'quick' : 'precise' } catch { return 'precise' } }
const DEVICE: 'wasm' | 'webgpu' = 'gpu' in navigator ? 'webgpu' : 'wasm'
const DEV = new URLSearchParams(location.search).has('dev')
const AB = new URLSearchParams(location.search).has('ab')
const DEMO_DATA = DEMO ? demoData(DEMO) : null // 개발 확인용 예시(?demo=1). 저장·서버 전송은 하지 않는다

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
  const [serverRx, setServerRx] = useState<Prescription[] | null>(null) // 서버가 계산한 추천(동기화했을 때만)
  const [records, setRecords] = useState<AnalysisRecord[]>(() => (DEMO_DATA ? [DEMO_DATA.prev] : loadRecords())) // 분석 기록(전후 비교용)
  const [prevSel, setPrevSel] = useState(0) // 비교할 지난 기록(0 = 가장 최근)
  const [mode, setMode] = useState<AnalysisMode>(loadMode) // 정밀 / 빠른 분석
  function onMode(m: AnalysisMode) { setMode(m); try { localStorage.setItem(MODE_KEY, m) } catch { /* 무시 */ } }
  // 쓰고 있음 / 사용하지 않음 표시. 이 브라우저에 두고, 로그인했으면 서버 피드백 기록에도 남긴다(같은 표시를 다시 누르면 지움)
  const [marks, setMarks] = useState<Marks>(() => (DEMO_DATA ? {} : loadMarks()))
  function onMark(key: string, m: Mark) {
    const next = toggleMark(marks, key, m)
    setMarks(next); setServerRx(null)
    if (DEMO_DATA) return
    saveMarks(next)
    if (getToken()) sendFeedback(key, next[key] ?? 'unmarked').catch(() => {})
  }
  const applied = usingKeys(marks)

  // 서버 동기화에 로그인돼 있으면 다른 기기에서 남긴 분석 기록도 합친다
  // 예시 화면: 분석 없이 정해 둔 결과를 바로 넣는다
  useEffect(() => {
    if (!DEMO_DATA) return
    const { result: r, cls: m } = DEMO_DATA
    setResult(r); setCtx(loadContext(r.conversations[0].platform)); setCls(m); setStep('done'); record(r, m)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (DEMO_DATA || !getToken()) return
    listServerRecords().then((rs) => setRecords(putRecords(rs))).catch(() => {})
    // 다른 기기나 캐시를 지우기 전에 누른 표시를 이어 받는다(서버 기록이 이긴다)
    listFeedback().then((rows) => setMarks((cur) => { const next = mergeServerMarks(cur, rows); saveMarks(next); return next })).catch(() => {})
  }, [])

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
    setLedger([]); setWeeks([]); setFeedback({}); setStorageMode('none'); setRecords([])
  }
  function onClearRecords() {
    if (!confirm('저장된 분석 기록(요약 숫자, 추천 이름, 적용함 표시)을 모두 지웁니다. 서버 동기화 중이면 서버 기록도 지웁니다. 계속할까요?')) return
    clearRecords(); setRecords([]); setPrevSel(0)
    if (getToken()) deleteServerRecords().catch(() => {})
  }

  async function onFile(list: FileList | File[] | null | undefined) {
    const files = [...(list ?? [])].filter((f) => /\.zip$/i.test(f.name))
    if (files.length === 0) return
    setError(''); setResult(null); setCls(null); setEmbedLog([]); setStep('read'); setDetail(''); setCtx(null); setNet([])
    const w = new Worker(new URL('./worker/analyze.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'progress') setStep(m.stage === 'unzip' ? 'read' : 'analyze')
      else if (m.type === 'result') { setResult(m); setServerRx(null); setCtx(loadContext(m.conversations[0]?.platform ?? 'chatgpt')); setAuditProbes(m.utterances.map((u) => u.text)); setNet((n) => [...n, ...m.net]); w.terminate(); classify(m) }
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
    setStep('model')
    // 남은 시간: 워커와 같은 문장('query: ' 접두어 포함) 길이로 진행 비율을 셈
    const lengths = texts.map((t) => t.length + 7)
    let etaStart: { f: number; t: number } | null = null
    const w = new Worker(new URL('./worker/embed.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<EmbedOut>) => {
      const m = e.data
      if (m.type === 'download') { setStep('model'); setDetail(`${m.file.split('/').pop()} ${m.percent}%`) }
      else if (m.type === 'progress') {
        const f = doneFraction(lengths, m.done), now = performance.now()
        etaStart ??= { f, t: now }
        setStep('classify'); setDetail(`${m.done} / ${m.total} · ${fmtRemaining(remainingMs(etaStart, f, now))}`)
      }
      else if (m.type === 'classified') { m.knn = pinCodeToCoding(m.knn, ok, r.conversations); m.centroid = pinCodeToCoding(m.centroid, ok, r.conversations); m.linear = pinCodeToCoding(m.linear, ok, r.conversations); setCls(m); setStep('done'); setDetail(''); record(r, m); w.terminate(); setNet((n) => [...n, ...m.net]); if (DEV) { measureMemory('분석 완료 직후'); Object.assign(window, { __relog: { result: r, cls: m } }) } } // 개발 모드: 콘솔에서 숫자 집계용(원문은 화면 밖으로 안 나감) // 임베딩·모델 메모리 회수
      else if (m.type === 'error') { setError(m.message); setStep('done'); w.terminate() }
    }
    // 플러그인 후보 설명(공개 문구)도 같은 모델로 임베딩해 '내 대화와 비슷한 순'을 낸다
    w.postMessage({ type: 'classify', model: ANALYSIS_MODES[mode].model, device: DEVICE, texts, conversationIds: ok.map((u) => u.conversationId), plugins: poolTexts(r.conversations[0]?.platform ?? 'chatgpt').texts })
  }

  // 발화 대장 갱신 → 주 단위 집계. 보관 모드면 IndexedDB에 병합(같은 키는 덮어쓰기)하고 전체 대장으로 재계산.
  async function record(r: Result, m: Classified) {
    const version = { parserVersion: r.parserVersion, normalizerVersion: r.normalizerVersion, modelVersion: m.modelVersion, classifierVersion: m.classifierVersion, detectorVersion: m.detectorVersion, catalogVersion: CATALOG_VERSION, recommendationRuleVersion: RECOMMENDATION_RULE_VERSION }
    const entries = buildLedger({ platform: r.conversations[0]?.platform ?? 'chatgpt', utterances: r.utterances, okIds: r.utterances.filter((u) => u.status === 'ok').map((u) => u.messageId), preds: m.linear, version })
    let all = entries
    if (storageMode === 'local' && !DEMO_DATA) {
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

  const [tab, setTab] = useState<'rx' | 'plugins' | 'trend'>('rx') // 결과 화면 탭: 추천 / 종류별 플러그인·시작 문구 / 변화
  const s = result?.stats
  const n = result?.normStats
  const stepIdx = STEPS.findIndex(([k]) => k === step)
  const preds = cls ? cls[method] : null
  const byType = preds ? countByType(preds) : null
  const agree = cls ? cls.linear.filter((p, i) => p.type === cls.centroid[i].type).length / cls.linear.length : 0

  // 추천: 집계 숫자(snapshot) + 체크리스트(ctx) + 로컬 피드백만 입력. 원문 없음.
  const platform: Platform = result?.conversations[0]?.platform ?? 'chatgpt'
  const snapshot = result && cls && s
    ? buildSnapshot({ platform, stats: s, utterances: result.utterances, okIds: result.utterances.filter((u) => u.status === 'ok').map((u) => u.messageId), preds: cls.linear, subByConversation: subByConversation(result.conversations) })
    : null
  // Codex는 plugins 폴더 zip에 설치 플러그인이 있으면 쓰는 것으로 본다(대화 기록은 받지 않음)
  const detected = result ? [...detectFeatures(result.conversations), ...(result.codexPlugins.length ? [{ catalogId: 'tool:codex', conversations: 0 }] : [])] : []
  const installed = result ? [...installedPlugins(result.conversations), ...result.codexPlugins] : [] // Claude Code 기록 + Codex plugins 폴더의 설치 플러그인
  // 추천 입력: 저장된 설정 + 파일에서 감지한 기능 + 내가 '쓰고 있음'으로 표시한 습관·기능
  const ctxIn = ctx ? (() => { const c = withDetected(ctx, detected); return { ...c, featuresInUse: [...new Set([...c.featuresInUse, ...applied])] } })() : null
  const prescriptions = snapshot && ctxIn ? recommend(snapshot, ctxIn, feedback) : []
  function onFeedback(id: string, f: Feedback) {
    const next = { ...feedback, [id]: f }
    setFeedback(next); saveFeedback(next)
    if (getToken() && !DEMO_DATA) sendFeedback(id, f).catch(() => {}) // 서버 동기화를 쓰는 중이면 피드백도 서버에 남긴다(추천 우선순위 조정용)
  }
  function onCtx(c: UserContext) { setCtx(c); saveContext(platform, c); setServerRx(null) }
  const shownRx = serverRx ?? prescriptions

  // 분석 기록: 이번 회차의 요약 숫자 + 추천 항목 이름. 분석이 끝나면 자동 저장(같은 내보내기는 덮어씀)
  // 종류별 플러그인 후보를 내 대화와 비교: 메시지 임베딩(분류 때 만든 것)의 종류별 평균 vs 후보 설명 임베딩. 숫자는 이 화면에서만 쓴다
  const pool = poolTexts(platform)
  const okTypes = cls ? cls.linear.map((p): SnapshotTask | null => TASK_MAP[p.type] ?? null) : []
  const simScores = cls && cls.dim > 0 && cls.pluginVecs.length === pool.names.length * cls.dim ? similarityScores(cls.embeddings, cls.dim, okTypes, cls.pluginVecs, pool.names) : {}
  const pluginRows = snapshot ? resolveTaskPlugins(snapshot, TASK_PLUGIN_MIN_MESSAGES, platform, simScores) : []
  const pluginNames = [...new Set(pluginRows.flatMap((r) => (r.status === 'recommend' ? r.ranked.slice(0, 3).map((p) => p.name) : [])))]
  const promptKeys = pluginRows.map((r) => promptKey(r.task))
  // 항목 키 → 겨냥한 대화 종류. 다음 분석 때 그 종류의 변화로 효과를 본다(코딩 세부 플러그인은 코딩).
  const itemTasks: Record<string, string> = Object.fromEntries([
    ...shownRx.flatMap((p) => (p.task ? [[p.catalogId, p.task]] : [])),
    ...pluginRows.flatMap((r) => r.ranked.map((p) => [p.name, r.task])),
    ...pluginRows.map((r) => [promptKey(r.task), r.task]),
    ...Object.entries(snapshot?.codingSub ?? {}).flatMap(([sub, n]) => { const sp = codingSubPlugin(sub as CodingSub, n ?? 0); return sp ? [[sp.pick.name, 'coding']] : [] }),
  ])
  const curRecord: AnalysisRecord | null = step === 'done' && !AB && snapshot && version && s && s.firstAt != null && s.lastAt != null
    ? { savedAt: 0, platform, firstAt: s.firstAt, lastAt: s.lastAt, versionKey: versionKey(version), conversations: snapshot.conversationCount, userTurns: s.userTurns, longConversations: s.longConversations, rx: shownRx.map((p) => p.catalogId), plugins: pluginNames, applied: applied.slice(-40), tasks: Object.fromEntries(Object.entries(itemTasks).filter(([k]) => applied.includes(k) || shownRx.some((p) => p.catalogId === k) || pluginNames.includes(k) || promptKeys.includes(k))) }
    : null
  const recKey = curRecord ? JSON.stringify(curRecord) : ''
  useEffect(() => {
    if (!curRecord || DEMO_DATA) return // 예시 화면은 기록을 남기지 않는다
    const r = { ...curRecord, savedAt: Date.now() }
    setRecords(putRecord(r))
    if (getToken()) putServerRecord(r).catch(() => {})
  }, [recKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const prevs = curRecord ? previousRecords(records, curRecord) : []
  const prevRecord = prevs[prevSel] ?? null
  const sinceCmp = prevRecord ? compareSince(weeks, prevRecord) : null
  const notes = repeatNotes(prevRecord, sinceCmp, [...(curRecord?.rx ?? []), ...pluginNames, ...promptKeys, ...Object.keys(itemTasks)])

  // 요약 카드: 가장 많이 한 대화 종류, 대화 습관(대화당 내 메시지)
  const topTask = snapshot ? (Object.entries(snapshot.taskShare) as [SnapshotTask, number][]).sort((a, b) => b[1] - a[1])[0] : undefined

  return (
    <main>
      {DEMO_DATA && <p className="err">예시 화면입니다(개발용). 대화는 지어낸 것이고, 기록·서버 전송을 하지 않습니다.</p>}

      {!result && <ExportGuide />}
      <fieldset className="modes" disabled={step !== 'idle' && step !== 'done'}>
        <legend>분석 방식<Help text="두 방식 모두 대화 내용은 이 브라우저 안에서만 분석합니다. 대화 종류(코딩·글·문서 등)를 나누는 정확도와 걸리는 시간이 다릅니다. 처음 한 번은 고른 방식의 모델을 내려받습니다." /></legend>
        {(Object.keys(ANALYSIS_MODES) as AnalysisMode[]).map((k) => (
          <label key={k} className={mode === k ? 'on' : ''}>
            <input type="radio" name="mode" checked={mode === k} onChange={() => onMode(k)} />
            <b>{ANALYSIS_MODES[k].label}</b>
            <small>{ANALYSIS_MODES[k].note}</small>
          </label>
        ))}
      </fieldset>
      <label
        className={'drop' + (over ? ' over' : '') + (result ? ' small' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input type="file" accept=".zip" multiple onChange={(e) => onFile(e.target.files)} />
        {result ? '다른 파일 분석' : 'ChatGPT·Claude 내보내기 zip을 끌어다 놓거나 클릭'}
      </label>
      {!result && <p className="detail">처음 한 번은 고른 방식의 분석 모델을 내려받습니다. 분석 시간은 메시지 수와 컴퓨터에 따라 다르며, 분석하는 동안 남은 시간을 보여 드립니다. 창을 닫거나 다른 탭에 오래 두면 느려질 수 있습니다.</p>}
      {!result && <p className="detail">Claude Code 기록(.claude 폴더 안의 projects 폴더를 zip으로 묶은 것)도 같이 넣을 수 있습니다. Codex에 설치한 플러그인을 추천에서 '이미 설치됨'으로 보려면 .codex 폴더 안의 plugins 폴더를 zip으로 묶어 같이 넣으세요(폴더 이름만 읽습니다).</p>}

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
          {/* 분석한 범위: 글 한 줄 대신 상자 하나에 칸으로(2026-11-24 사용자 요청) */}
          <div className="facts">
            <div><span>대화</span><b>{s.conversations.toLocaleString()}</b></div>
            <div><span>내 메시지</span><b>{s.userTurns.toLocaleString()}</b></div>
            <div><span>긴 대화<Help text="내 메시지가 10개 이상인 대화입니다." /></span><b>{s.longConversations.toLocaleString()}</b></div>
            <div className="wide"><span>기간</span><b>{fmtDate(s.firstAt)} ~ {fmtDate(s.lastAt)}</b></div>
          </div>
          {/* 요약 숫자는 탭 위에 늘 보이고, 나머지는 화면 폭과 상관없이 탭으로 하나씩 넓게 보여 준다(2026-11-18 사용자 요청) */}
          {snapshot && (
            <div className="summary">
              {/* 디자인 B: 핵심 숫자(가장 많이 한 대화 종류)는 초록 큰 카드, 지금 필요한 추천은 주황 카드(누르면 추천 탭) */}
              <div className="card hero">
                <b>{topTask && topTask[1] > 0 ? `${Math.round(topTask[1] * 100)}%` : '-'}</b>
                <span>{topTask && topTask[1] > 0 ? `${SNAPSHOT_LABEL[topTask[0]]} 대화` : '대화 종류'}<Help text="내 메시지를 대화 종류(코딩·글·문서 등)로 나눴을 때 가장 많은 종류의 비율입니다. 종류는 자동 추정이라 틀릴 수 있습니다. 전체 비율은 아래 '보관 · 자세한 숫자'에 있습니다." /></span>
                <small>가장 많이 한 대화 종류 · 내 메시지 {snapshot.userTurnCount.toLocaleString()}개 기준</small>
              </div>
              <div className="card"><b>{snapshot.avgTurnsPerConversation.toFixed(1)}개</b><span>대화당 내 메시지</span><small>긴 대화(10개 이상) {Math.round(snapshot.longConversationShare * 100)}%</small></div>
              {!AB && shownRx[0]
                ? <button className="card hot" onClick={() => setTab('rx')}><b>{shownRx[0].name}</b><span>{shownRx[0].grade === '핵심' ? '지금 필요한 것' : '해 볼 만한 것'}</span><small>{shownRx[0].summary}</small></button>
                : <div className="card"><b>{snapshot.conversationCount}</b><span>대화</span><small>내 메시지가 있는 대화</small></div>}
            </div>
          )}
          <nav className="tabs">
            <button className={tab === 'rx' ? 'on' : ''} onClick={() => setTab('rx')}>{AB ? '추천 평가' : '추천'}{shownRx.length > 0 && <em>{shownRx.length}</em>}</button>
            {!AB && <button className={tab === 'plugins' ? 'on' : ''} onClick={() => setTab('plugins')}>종류별 플러그인·시작 문구</button>}
            <button className={tab === 'trend' ? 'on' : ''} onClick={() => setTab('trend')}>변화</button>
          </nav>

          <div className={'panel' + (tab === 'rx' ? ' on' : '')}>
          {!cls && <p className="detail">분석 중입니다.</p>}
          {snapshot && ctxIn && (AB
            ? <AbMode platform={platform} personalized={prescriptions} snapshot={snapshot} weeks={weeks} version={version} ctx={ctxIn} />
            : <Prescriptions items={shownRx} feedback={feedback} onFeedback={onFeedback} installed={installed} notes={notes} marks={marks} onMark={onMark} />)}
          </div>

          {!AB && (
            <div className={'panel' + (tab === 'plugins' ? ' on' : '')}>
            {snapshot && (
              <>
                <p className="detail">대화 종류마다 추천 플러그인과 새 채팅 첫 메시지로 붙여 넣을 시작 문구입니다{platform === 'chatgpt' ? ' (ChatGPT·Codex)' : ''}.<Help text={`많이 쓴 대화 종류 순이고, 모든 종류에 플러그인과 새 채팅 시작 문구를 보여 줍니다. 그 종류 메시지가 ${TASK_PLUGIN_MIN_MESSAGES}개 미만이면 참고로만 표시합니다. ${platform === 'claude' ? 'Claude Code 기록의 메시지는 모두 코딩으로 셉니다. ' : 'ChatGPT와 Codex는 같은 플러그인 목록을 써서, 같은 이름으로 Codex에도 설치할 수 있습니다. '}효과는 아직 검증되지 않았습니다.`} /></p>
                <TaskPlugins rows={pluginRows} codingSub={snapshot.codingSub} installed={installed} platform={platform} notes={notes} marks={marks} onMark={onMark} />
                <PluginSearch key={platform} installed={installed} platform={platform} />
              </>
            )}
            </div>
          )}

          <div className={'panel' + (tab === 'trend' ? ' on' : '')}>
          {curRecord && (
            <>
              <p className="label">지난 분석과 비교</p>
              <History cur={{ ...curRecord, savedAt: Date.now() }} prevs={prevs} sel={prevSel} onSel={setPrevSel} cmp={sinceCmp} installed={installed} onClear={onClearRecords} />
              <p className="label">이번 기록 안의 변화</p>
            </>
          )}
          <Trend weeks={weeks} />
          {snapshot && version && <ReportFile snapshot={snapshot} weeks={weeks} version={version} />}
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
              {!DEMO_DATA && <SyncPanel weeks={weeks} version={version} snapshot={snapshot} ctx={ctxIn} onServer={(r) => setServerRx(r.prescriptions)} />}
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
                  {result.codexPlugins.length > 0 && <tr><td>Codex 설치 플러그인</td><td>{result.codexPlugins.join(', ')}</td></tr>}
                  <tr><td>AI 답변 수</td><td>{s.assistantTurns}</td></tr>
                  <tr><td>비교한 내 메시지 (메시지 2개 이상인 대화)</td><td>{s.judgeableUserTurns}</td></tr>
                  <tr><td>내 메시지 분량 (토큰, 추정)</td><td>{s.userTokenEstimate.toLocaleString()}</td></tr>
                  <tr><td>AI 답변 분량 (토큰, 추정) · 답변 하나 평균 · 내 메시지 대비</td><td>{s.assistantTokenEstimate.toLocaleString()} · {s.assistantTurns ? Math.round(s.assistantTokenEstimate / s.assistantTurns) : 0} · {s.userTokenEstimate ? (s.assistantTokenEstimate / s.userTokenEstimate).toFixed(1) : '0'}배</td></tr>
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
                  <RecommendDev snapshot={snapshot} ctx={ctxIn ?? withDetected(ctx, detected)} feedback={feedback} />
                </>
              )}
              <h2>개발: 대화 종류 정답 찍기</h2>
              <p className="detail">내 메시지 하나하나가 어떤 종류(코딩·글쓰기 등)인지 사람이 정답을 찍는 화면입니다. 정답이 쌓이면 자동 분류 A/B/C 세 방식 중 무엇이 가장 잘 맞는지 eval/classify/run_abc.mjs로 비교합니다. 목표 400개.</p>
              <Labeler utterances={result.utterances} conversations={result.conversations} />
              <h2>개발: 분류 내부 숫자</h2>
              {cls && (
                <p className="detail">
                  플러그인 후보 비교(종류 평균 − 전체 평균): {pluginRows.filter((r) => r.bySimilarity).map((r) => `${SNAPSHOT_LABEL[r.task]} ${r.ranked.slice(0, 3).map((p) => `${p.name} ${(p.score ?? 0).toFixed(3)}`).join(', ')}`).join(' / ') || '비교한 종류 없음'}
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
