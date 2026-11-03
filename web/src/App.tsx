import { useState, type DragEvent } from 'react'
import type { WorkerOut } from './worker/analyze.worker'
import type { EmbedOut } from './worker/embed.worker'

type Result = Extract<WorkerOut, { type: 'result' }>
type Step = 'idle' | 'read' | 'analyze' | 'done'

const STEPS: [Step, string][] = [['read', '파일 읽기'], ['analyze', '분석'], ['done', '완료']]
const MODELS = ['Xenova/multilingual-e5-small', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'] as const
const DEV = new URLSearchParams(location.search).has('dev')

const fmtDate = (ms: number | null) => (ms == null ? '-' : new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }))

export default function App() {
  const [step, setStep] = useState<Step>('idle')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)
  const [embedLog, setEmbedLog] = useState<string[]>([])

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(''); setResult(null); setEmbedLog([]); setStep('read')
    const w = new Worker(new URL('./worker/analyze.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'progress') setStep(m.stage === 'unzip' ? 'read' : 'analyze')
      else if (m.type === 'result') { setResult(m); setStep('done') }
      else { setError(m.message); setStep('idle') }
    }
    const buf = await file.arrayBuffer()
    w.postMessage({ type: 'parse', data: buf }, [buf])
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); setOver(false)
    onFile(e.dataTransfer.files[0])
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
      else setEmbedLog((l) => [...l, `${tag}: 오류 ${m.message}`])
    }
    w.postMessage({ type: 'embed', model, device, texts })
  }

  const s = result?.stats
  const n = result?.normStats
  const stepIdx = STEPS.findIndex(([k]) => k === step)
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
        <ol className="steps">
          {STEPS.map(([k, label], i) => (
            <li key={k} className={i < stepIdx ? 'done' : i === stepIdx ? 'active' : ''}>{label}</li>
          ))}
        </ol>
      )}
      {error && <p className="err">{error}</p>}

      {result && s && n && (
        <section>
          <h2>요약</h2>
          <div className="cards">
            <div className="card"><b>{s.conversations}</b><span>대화</span></div>
            <div className="card"><b>{s.userTurns}</b><span>내 발화</span></div>
            <div className="card"><b>{s.longConversations}</b><span>긴 대화 (발화 10개 이상)</span></div>
            <div className="card"><b style={{ fontSize: '1rem' }}>{fmtDate(s.firstAt)} ~ {fmtDate(s.lastAt)}</b><span>기간</span></div>
          </div>
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
                <tr><td>버전</td><td>{result.parserVersion}, {result.normalizerVersion}</td></tr>
              </tbody>
            </table>
            {result.errors.length > 0 && <pre>{JSON.stringify(result.errors.slice(0, 20), null, 2)}</pre>}
          </details>

          {DEV && (
            <>
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
