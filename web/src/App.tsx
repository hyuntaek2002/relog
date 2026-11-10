import { useEffect, useState, type DragEvent } from 'react'
import type { WorkerOut } from './worker/analyze.worker'
import type { EmbedOut } from './worker/embed.worker'
import { TASK_LABELS, TASK_TYPES, type Method, type Prediction } from './classify/classifier'
import Labeler from './dev/Labeler'
import PairLabeler from './dev/PairLabeler'
import Checklist, { loadContext, saveContext, withDetected } from './recommend/Checklist'
import { detectFeatures } from './recommend/detectFeatures'
import Prescriptions, { loadFeedback, saveFeedback } from './recommend/Prescriptions'
import AbMode from './recommend/AbMode'
import RecommendDev from './recommend/RecommendDev'
import { buildSnapshot } from './recommend/snapshot'
import { CATALOG_VERSION, RECOMMENDATION_RULE_VERSION, recommend, type Feedback, type FeedbackMap, type Platform, type UserContext } from './recommend/recommend'
import Trend, { StorageChoice, loadStorageMode, STORAGE_MODE_KEY, type StorageMode } from './store/Trend'
import { aggregateWeekly, buildLedger, versionKey, type AnalysisVersion, type LedgerEntry, type PeriodSnapshot } from './store/ledger'
import SyncPanel from './store/SyncPanel'
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
  const [method, setMethod] = useState<Method>('knn')
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)
  const [embedLog, setEmbedLog] = useState<string[]>([])
  const [ctx, setCtx] = useState<UserContext | null>(null)
  const [feedback, setFeedback] = useState<FeedbackMap>(loadFeedback)
  const [storageMode, setStorageMode] = useState<StorageMode>(loadStorageMode)
  const [ledger, setLedger] = useState<LedgerEntry[]>([]) // 보관 모드면 IndexedDB 전체, 아니면 이번 분석분만
  const [weeks, setWeeks] = useState<PeriodSnapshot[]>([])
  const [version, setVersion] = useState<AnalysisVersion | null>(null) // 이번 분석의 AnalysisVersion(동기화에 함께 보냄)
  const [net, setNet] = useState<NetRecord[]>([]) // 네트워크 감사 기록(페이지 + 워커)

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

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(''); setResult(null); setCls(null); setEmbedLog([]); setStep('read'); setDetail(''); setCtx(null); setNet([])
    const w = new Worker(new URL('./worker/analyze.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'progress') setStep(m.stage === 'unzip' ? 'read' : 'analyze')
      else if (m.type === 'result') { setResult(m); setCtx(loadContext(m.conversations[0]?.platform ?? 'chatgpt')); setAuditProbes(m.utterances.map((u) => u.text)); setNet((n) => [...n, ...m.net]); w.terminate(); classify(m) }
      else { setError(m.message); setStep('idle'); w.terminate() }
    }
    const buf = await file.arrayBuffer()
    w.postMessage({ type: 'parse', data: buf }, [buf])
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); setOver(false)
    onFile(e.dataTransfer.files[0])
  }

  // 정규화된 ok 발화 전체를 임베딩하고 과업 유형을 예측한다. 전부 브라우저 안에서.
  function classify(r: Result) {
    const ok = r.utterances.filter((u) => u.status === 'ok')
    const texts = ok.map((u) => u.text)
    if (texts.length === 0) { setStep('done'); return }
    const inputs = ok.map((u) => ({ conversationId: u.conversationId, messageId: u.messageId, idx: u.idx, createdAt: u.createdAt, text: u.text, tokenEstimate: u.tokenEstimate, hasAttachment: u.hasAttachment, prevAssistantIdx: u.prevAssistantIdx }))
    setStep('model')
    const w = new Worker(new URL('./worker/embed.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<EmbedOut>) => {
      const m = e.data
      if (m.type === 'download') { setStep('model'); setDetail(`${m.file.split('/').pop()} ${m.percent}%`) }
      else if (m.type === 'progress') { setStep('classify'); setDetail(`${m.done} / ${m.total}`) }
      else if (m.type === 'classified') { setCls(m); setStep('done'); setDetail(''); record(r, m); w.terminate(); setNet((n) => [...n, ...m.net]); if (DEV) measureMemory('분석 완료 직후') } // 임베딩·모델 메모리 회수
      else if (m.type === 'error') { setError(m.message); setStep('done'); w.terminate() }
    }
    w.postMessage({ type: 'classify', model: DEFAULT_MODEL, device: DEVICE, texts, inputs })
  }

  // 발화 대장 갱신 → 주 단위 집계. 보관 모드면 IndexedDB에 병합(같은 키는 덮어쓰기)하고 전체 대장으로 재계산.
  async function record(r: Result, m: Classified) {
    const version = { parserVersion: r.parserVersion, normalizerVersion: r.normalizerVersion, modelVersion: m.modelVersion, classifierVersion: m.classifierVersion, detectorVersion: m.detectorVersion, catalogVersion: CATALOG_VERSION, recommendationRuleVersion: RECOMMENDATION_RULE_VERSION }
    const entries = buildLedger({ platform: r.conversations[0]?.platform ?? 'chatgpt', utterances: r.utterances, okIds: r.utterances.filter((u) => u.status === 'ok').map((u) => u.messageId), preds: m.knn, pairs: m.pairs, version })
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

  const s = result?.stats
  const n = result?.normStats
  const stepIdx = STEPS.findIndex(([k]) => k === step)
  const textById = new Map(result?.utterances.map((u) => [u.messageId, u.text]))
  const titleById = new Map(result?.conversations.map((c) => [c.id, c.title]))
  const textOf = (id: string) => (textById.get(id) ?? '').slice(0, 400)
  const titleOf = (id: string) => titleById.get(id) || '(제목 없음)'
  const preds = cls ? cls[method] : null
  const byType = preds ? countByType(preds) : null
  const agree = cls ? cls.knn.filter((p, i) => p.type === cls.centroid[i].type).length / cls.knn.length : 0

  // 추천: 집계 숫자(snapshot) + 체크리스트(ctx) + 로컬 피드백만 입력. 원문 없음.
  const platform: Platform = result?.conversations[0]?.platform ?? 'chatgpt'
  const snapshot = result && cls && s
    ? buildSnapshot({ platform, stats: s, utterances: result.utterances, okIds: result.utterances.filter((u) => u.status === 'ok').map((u) => u.messageId), preds: cls.knn, candidates: cls.candidates, detect: cls.detectSummary })
    : null
  const detected = result ? detectFeatures(result.conversations) : []
  const prescriptions = snapshot && ctx ? recommend(snapshot, withDetected(ctx, detected), feedback) : []
  function onFeedback(id: string, f: Feedback) {
    const next = { ...feedback, [id]: f }
    setFeedback(next); saveFeedback(next)
  }
  function onCtx(c: UserContext) { setCtx(c); saveContext(platform, c) }

  const flagged = cls ? cls.candidates : []
  const shown = [...flagged]
    .filter((c) => DEV || c.grade !== 'low') // '약함'은 같은 주제의 후속 발화가 많이 섞여 기본 화면에선 숫자만
    .sort((a, b) => (a.grade === b.grade ? b.similarity - a.similarity : (a.grade === 'high' ? -1 : b.grade === 'high' ? 1 : a.grade === 'medium' ? -1 : 1)))
    .slice(0, 20)

  return (
    <main>
      <h1>relog</h1>
      <p className="sub">대화 내보내기 파일을 넣으면 이 브라우저 안에서만 분석합니다. 대화 내용은 어디로도 전송되지 않습니다.</p>

      <label
        className={'drop' + (over ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input type="file" accept=".zip" onChange={(e) => onFile(e.target.files?.[0])} />
        ChatGPT 또는 Claude 내보내기 zip을 여기에 끌어다 놓거나 클릭해서 선택
      </label>

      {step !== 'idle' && (
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
          <h2>보관 방식</h2>
          <StorageChoice mode={storageMode} storedCount={ledger.length} onMode={onStorageMode} onClear={onClear} />
          {weeks.length > 0 && (
            <>
              <h2>저장된 변화</h2>
              <Trend weeks={weeks} />
            </>
          )}
        </section>
      )}

      {result && ctx && (
        <section>
          <h2>내 설정</h2>
          <Checklist platform={platform} value={ctx} detected={detected} onChange={onCtx} />
        </section>
      )}

      {result && s && n && (
        <section>
          <h2>요약</h2>
          <div className="cards">
            <div className="card"><b>{s.conversations}</b><span>대화</span></div>
            <div className="card"><b>{s.userTurns}</b><span>내 메시지</span></div>
            <div className="card"><b>{s.longConversations}</b><span>긴 대화 (내 메시지 10개 이상)</span></div>
            <div className="card"><b style={{ fontSize: '1rem' }}>{fmtDate(s.firstAt)} ~ {fmtDate(s.lastAt)}</b><span>기간</span></div>
          </div>

          {cls && (
            <>
              <h2>다시 말한 지시</h2>
              <div className="cards">
                <div className="card"><b>{flagged.length}</b><span>다시 말한 지시 (확실함 {cls.detectSummary.byGrade.high} · 가능성 있음 {cls.detectSummary.byGrade.medium} · 약함 {cls.detectSummary.byGrade.low})</span></div>
                <div className="card"><b>{cls.detectSummary.ratio.toFixed(1)}%</b><span>비교한 내 메시지 {cls.detectSummary.judgeable}개 중 비율</span></div>
                <div className="card"><b>{cls.detectSummary.tokenEstimate.toLocaleString()}</b><span>다시 친 분량 (토큰, 추정)</span></div>
              </div>
              <p className="detail">
                같은 대화에서 앞서 한 지시를 다시 말한 것으로 보이는 메시지입니다. AI가 지시를 따랐는지는 판정하지 않습니다. 아래 내용은 이 화면에만 보입니다.
                <br />따로 센 것: 비슷한 질문 다시 함 {cls.detectSummary.repeatedQuestions}건 · 말이 안 통한 듯한 표현 {cls.detectSummary.misunderstanding}건
              </p>
              {shown.length === 0 && <p className="detail">확실함·가능성 있음으로 잡힌 메시지가 없습니다.</p>}
              {shown.map((c) => (
                // 기본은 한 줄 요약만. 펼쳐야 앞/뒤 메시지가 보인다(원문은 이 화면에만).
                <details className="cand" key={c.messageId}>
                  <summary className="meta">
                    <span className={`grade-${c.grade}`}>{GRADE_LABEL[c.grade ?? 'low']}</span>
                    <span>{titleOf(c.conversationId)}</span>
                    <span>{textOf(c.messageId).slice(0, 40).replace(/\s+/g, ' ')}{textOf(c.messageId).length > 40 ? '…' : ''}</span>
                    {c.repeatMarker && <span>"아까 말했" 같은 표현</span>}
                    {c.complaintMarker && <span>답답함 표현</span>}
                    {c.gapMinutes != null && <span>{c.gapMinutes < 60 ? `${Math.round(c.gapMinutes)}분 뒤` : `${Math.round(c.gapMinutes / 60)}시간 뒤`}</span>}
                  </summary>
                  <p className="detail">앞 메시지와 비슷한 정도 {c.similarity.toFixed(2)}{!c.responseBetween && ' · 사이에 AI 답이 없음'}</p>
                  <blockquote>{textOf(c.priorMessageId)}</blockquote>
                  <blockquote className="now">{textOf(c.messageId)}</blockquote>
                </details>
              ))}
            </>
          )}

          {snapshot && ctx && (
            <>
              <h2>{AB ? '추천 평가' : '추천'}</h2>
              {AB ? <AbMode platform={platform} personalized={prescriptions} /> : <Prescriptions items={prescriptions} feedback={feedback} onFeedback={onFeedback} />}
            </>
          )}

          <h2>변화</h2>
          <Trend weeks={weeks} />

          <details>
            <summary>보관 · 서버 동기화 · 자세한 숫자</summary>
            <h2>보관 방식</h2>
            <StorageChoice mode={storageMode} storedCount={storageMode === 'local' ? ledger.length : 0} onMode={onStorageMode} onClear={onClear} />
            <h2>서버 동기화 (선택)</h2>
            <SyncPanel weeks={weeks} version={version} />
            {byType && preds && (
              <>
                <h2>대화 종류 비율</h2>
                <ul className="bars">
                  {byType.filter((t) => t.n > 0).map((t) => (
                    <li key={t.type}>
                      <span>{t.label}</span>
                      <i style={{ width: `${(100 * t.n) / preds.length}%` }} />
                      <em>{Math.round((100 * t.n) / preds.length)}%</em>
                    </li>
                  ))}
                </ul>
                <p className="detail">내 메시지 {preds.length}개 기준. 종류는 자동 추정이라 틀릴 수 있습니다.</p>
              </>
            )}
            <h2>자세한 숫자</h2>
            <table>
              <tbody>
                <tr><td>읽은 파일</td><td>{result.files.join(', ')}</td></tr>
                <tr><td>AI 답변 수</td><td>{s.assistantTurns}</td></tr>
                <tr><td>비교한 내 메시지 (메시지 2개 이상인 대화)</td><td>{s.judgeableUserTurns}</td></tr>
                <tr><td>내 메시지 분량 (토큰, 추정)</td><td>{s.userTokenEstimate.toLocaleString()}</td></tr>
                <tr><td>분석에서 뺀 메시지 (응, 계속 등)</td><td>{n.skipped}</td></tr>
                <tr><td>앞뒤 문맥이 있어야 뜻을 아는 짧은 메시지</td><td>{n.context_required}</td></tr>
                <tr><td>코드가 포함된 메시지</td><td>{n.hasCode}</td></tr>
                <tr><td>읽지 못한 대화</td><td>{result.errors.length}</td></tr>
                <tr><td>버전</td><td>{result.parserVersion}, {result.normalizerVersion}{cls && `, ${cls.modelVersion}, ${cls.classifierVersion}, ${cls.detectorVersion}`}, {CATALOG_VERSION}, {RECOMMENDATION_RULE_VERSION}</td></tr>
              </tbody>
            </table>
            {result.errors.length > 0 && <pre>{JSON.stringify(result.errors.slice(0, 20), null, 2)}</pre>}
          </details>

          {DEV && (
            <details className="devbox">
              <summary>개발자 패널 (?dev=1)</summary>
              {snapshot && ctx && (
                <>
                  <h2>개발: 추천 점수표</h2>
                  <RecommendDev snapshot={snapshot} ctx={withDetected(ctx, detected)} feedback={feedback} />
                </>
              )}
              {cls && (
                <>
                  <h2>개발: 반복 후보 쌍 라벨링 (유사도 상위 100)</h2>
                  <PairLabeler pairs={cls.pairs} utterances={result.utterances} conversations={result.conversations} />
                </>
              )}
              <h2>개발: 과업 라벨링</h2>
              <Labeler utterances={result.utterances} conversations={result.conversations} />
              <h2>개발: 분류·탐지</h2>
              {cls && (
                <p className="detail">
                  유사도 분포(판단 가능 발화 {cls.sims.length}개): {[0.5, 0.75, 0.9, 0.95, 0.98].map((q) => `p${q * 100}=${quantile(cls.sims, q).toFixed(3)}`).join(' ')}
                  <br />귀무분포(같은 대화 비인접 {cls.nullSims.length}쌍): {[0.5, 0.9, 0.95, 0.99].map((q) => `p${q * 100}=${quantile(cls.nullSims, q).toFixed(3)}`).join(' ')} → 경계 {cls.detectSummary.nullThreshold.toFixed(3)}, 경계 이상 {cls.sims.filter((s) => s >= cls.detectSummary.nullThreshold).length}쌍
                  <br />제외: {Object.entries(cls.detectSummary.excluded).map(([k, v]) => `${k} ${v}`).join(' · ')}
                </p>
              )}
              {cls && (
                <p>
                  방식: <button onClick={() => setMethod('knn')} disabled={method === 'knn'}>C k-NN</button>
                  <button onClick={() => setMethod('centroid')} disabled={method === 'centroid'}>B 중심점</button>
                  B·C 일치율 {Math.round(agree * 100)}%, 임베딩 {cls.embedMs}ms ({(cls.embedMs / cls.knn.length).toFixed(0)}ms/개), {DEVICE}
                </p>
              )}
              <h2>개발: 네트워크 감사</h2>
              <NetAudit records={[...net, ...peekAuditRecords()]} />
              <h2>개발: 메모리</h2>
              <p><button onClick={() => measureMemory('수동')}>지금 측정</button></p>
              <h2>개발: 임베딩 속도 (발화 100개)</h2>
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
