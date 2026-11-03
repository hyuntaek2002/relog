import { useState, type DragEvent } from 'react'
import type { WorkerOut } from './worker/analyze.worker'
import type { EmbedOut } from './worker/embed.worker'
import { TASK_LABELS, TASK_TYPES, type Method, type Prediction } from './classify/classifier'
import Labeler from './dev/Labeler'
import Checklist, { loadContext, saveContext, withDetected } from './recommend/Checklist'
import { detectFeatures } from './recommend/detectFeatures'
import Prescriptions, { loadFeedback, saveFeedback } from './recommend/Prescriptions'
import AbMode from './recommend/AbMode'
import RecommendDev from './recommend/RecommendDev'
import { buildSnapshot } from './recommend/snapshot'
import { CATALOG_VERSION, RECOMMENDATION_RULE_VERSION, recommend, type Feedback, type FeedbackMap, type Platform, type UserContext } from './recommend/recommend'

type Result = Extract<WorkerOut, { type: 'result' }>
type Classified = Extract<EmbedOut, { type: 'classified' }>
type Step = 'idle' | 'read' | 'analyze' | 'model' | 'classify' | 'done'

const STEPS: [Step, string][] = [['read', '파일 읽기'], ['analyze', '분석'], ['model', '모델 준비'], ['classify', '분류'], ['done', '완료']]
const MODELS = ['Xenova/multilingual-e5-small', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'] as const
const DEFAULT_MODEL = MODELS[0]
const DEVICE: 'wasm' | 'webgpu' = 'gpu' in navigator ? 'webgpu' : 'wasm'
const DEV = new URLSearchParams(location.search).has('dev')
const AB = new URLSearchParams(location.search).has('ab')

const fmtDate = (ms: number | null) => (ms == null ? '-' : new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }))

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

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(''); setResult(null); setCls(null); setEmbedLog([]); setStep('read'); setDetail(''); setCtx(null)
    const w = new Worker(new URL('./worker/analyze.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'progress') setStep(m.stage === 'unzip' ? 'read' : 'analyze')
      else if (m.type === 'result') { setResult(m); setCtx(loadContext(m.conversations[0]?.platform ?? 'chatgpt')); classify(m) }
      else { setError(m.message); setStep('idle') }
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
      else if (m.type === 'classified') { setCls(m); setStep('done'); setDetail('') }
      else if (m.type === 'error') { setError(m.message); setStep('done') }
    }
    w.postMessage({ type: 'classify', model: DEFAULT_MODEL, device: DEVICE, texts, inputs })
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

  // 처방: 집계 숫자(snapshot) + 체크리스트(ctx) + 로컬 피드백만 입력. 원문 없음.
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
            <div className="card"><b>{s.userTurns}</b><span>내 발화</span></div>
            <div className="card"><b>{s.longConversations}</b><span>긴 대화 (발화 10개 이상)</span></div>
            <div className="card"><b style={{ fontSize: '1rem' }}>{fmtDate(s.firstAt)} ~ {fmtDate(s.lastAt)}</b><span>기간</span></div>
          </div>

          {byType && preds && (
            <>
              <h2>무엇을 주로 했나</h2>
              <ul className="bars">
                {byType.filter((t) => t.n > 0).map((t) => (
                  <li key={t.type}>
                    <span>{t.label}</span>
                    <i style={{ width: `${(100 * t.n) / preds.length}%` }} />
                    <em>{Math.round((100 * t.n) / preds.length)}%</em>
                  </li>
                ))}
              </ul>
              <p className="detail">발화 {preds.length}개 기준. 유형은 자동 추정이라 틀릴 수 있습니다.</p>
            </>
          )}

          {cls && (
            <>
              <h2>반복 지시 의심</h2>
              <div className="cards">
                <div className="card"><b>{cls.candidates.length}</b><span>의심 발화 (높음 {cls.detectSummary.byGrade.high} · 중간 {cls.detectSummary.byGrade.medium} · 낮음 {cls.detectSummary.byGrade.low})</span></div>
                <div className="card"><b>{cls.detectSummary.ratio.toFixed(1)}%</b><span>반복 비율 (비교 가능한 발화 {cls.detectSummary.judgeable}개 중)</span></div>
                <div className="card"><b>{cls.detectSummary.tokenEstimate.toLocaleString()}</b><span>재입력 토큰 추정치</span></div>
              </div>
              <p className="detail">
                같은 대화에서 앞서 한 지시와 비슷한 지시입니다. 모델 응답이 요구를 따랐는지는 판정하지 않습니다. 아래 내용은 이 화면에만 표시됩니다.
                <br />따로 센 것: 반복 질문 {cls.detectSummary.repeatedQuestions}건 · 이해 실패 의심(항의 표현) {cls.detectSummary.misunderstanding}건
              </p>
              {[...cls.candidates]
                .filter((c) => DEV || c.grade !== 'low') // 낮음 등급은 같은 주제의 후속 발화가 많이 섞여 기본 화면에선 숫자만
                .sort((a, b) => (a.grade === b.grade ? b.similarity - a.similarity : (a.grade === 'high' ? -1 : b.grade === 'high' ? 1 : a.grade === 'medium' ? -1 : 1)))
                .slice(0, 20)
                .map((c) => (
                  <div className="cand" key={c.messageId}>
                    <div className="meta">
                      <span className={`grade-${c.grade}`}>{c.grade === 'high' ? '높음' : c.grade === 'medium' ? '중간' : '낮음'}</span>
                      <span>{titleOf(c.conversationId)}</span>
                      <span>유사도 {c.similarity.toFixed(2)}</span>
                      {c.repeatMarker && <span>반복 표지</span>}
                      {c.complaintMarker && <span>항의 표현</span>}
                      {!c.responseBetween && <span>사이에 응답 없음</span>}
                      {c.gapMinutes != null && <span>{c.gapMinutes < 60 ? `${Math.round(c.gapMinutes)}분 뒤` : `${Math.round(c.gapMinutes / 60)}시간 뒤`}</span>}
                    </div>
                    <blockquote>{textOf(c.priorMessageId)}</blockquote>
                    <blockquote className="now">{textOf(c.messageId)}</blockquote>
                  </div>
                ))}
            </>
          )}

          {snapshot && ctx && (
            <>
              <h2>{AB ? '추천 평가' : '처방'}</h2>
              {AB ? <AbMode platform={platform} personalized={prescriptions} /> : <Prescriptions items={prescriptions} feedback={feedback} onFeedback={onFeedback} />}
            </>
          )}

          <details>
            <summary>자세히</summary>
            <table>
              <tbody>
                <tr><td>읽은 파일</td><td>{result.files.join(', ')}</td></tr>
                <tr><td>모델 응답</td><td>{s.assistantTurns}</td></tr>
                <tr><td>비교 가능한 발화 (발화 2개 이상인 대화)</td><td>{s.judgeableUserTurns}</td></tr>
                <tr><td>내 발화 토큰 추정치</td><td>{s.userTokenEstimate.toLocaleString()}</td></tr>
                <tr><td>분석 제외 발화 (응, 계속 등)</td><td>{n.skipped}</td></tr>
                <tr><td>앞뒤 문맥이 필요한 짧은 발화</td><td>{n.context_required}</td></tr>
                <tr><td>코드가 포함된 발화</td><td>{n.hasCode}</td></tr>
                <tr><td>읽지 못한 대화</td><td>{result.errors.length}</td></tr>
                <tr><td>버전</td><td>{result.parserVersion}, {result.normalizerVersion}{cls && `, ${cls.modelVersion}, ${cls.classifierVersion}, ${cls.detectorVersion}`}, {CATALOG_VERSION}, {RECOMMENDATION_RULE_VERSION}</td></tr>
              </tbody>
            </table>
            {result.errors.length > 0 && <pre>{JSON.stringify(result.errors.slice(0, 20), null, 2)}</pre>}
          </details>

          {DEV && (
            <>
              {snapshot && ctx && (
                <>
                  <h2>개발: 처방 점수표</h2>
                  <RecommendDev snapshot={snapshot} ctx={withDetected(ctx, detected)} feedback={feedback} />
                </>
              )}
              <h2>개발: 라벨링</h2>
              <Labeler utterances={result.utterances} conversations={result.conversations} />
              <h2>개발: 분류</h2>
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
              <h2>개발: 임베딩 속도 (발화 100개)</h2>
              {MODELS.map((m) => (
                <p key={m}>{m}: <button onClick={() => runEmbed(m, 'wasm')}>wasm</button><button onClick={() => runEmbed(m, 'webgpu')}>webgpu</button></p>
              ))}
              <pre>{embedLog.join('\n')}</pre>
            </>
          )}
        </section>
      )}
    </main>
  )
}
