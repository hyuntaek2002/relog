import { useState } from 'react'
import type { WorkerOut } from './worker/analyze.worker'
import type { EmbedOut } from './worker/embed.worker'

type Result = Extract<WorkerOut, { type: 'result' }>

const MODELS = ['Xenova/multilingual-e5-small', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'] as const

export default function App() {
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [embedLog, setEmbedLog] = useState<string[]>([])

  async function onFile(file: File) {
    setError(''); setResult(null); setEmbedLog([])
    const w = new Worker(new URL('./worker/analyze.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'progress') setProgress(`${m.stage} ${m.done}/${m.total}`)
      else if (m.type === 'result') { setResult(m); setProgress('완료') }
      else setError(m.message)
    }
    const buf = await file.arrayBuffer()
    w.postMessage({ type: 'parse', data: buf }, [buf])
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
  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 800, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>relog</h1>
      <p>ChatGPT 또는 Claude 내보내기 zip을 선택하면 브라우저 안에서만 분석한다. 대화 원문은 서버로 전송되지 않는다.</p>
      <input type="file" accept=".zip" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <p>{progress}</p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {result && s && n && (
        <section>
          <h2>기본 통계</h2>
          <table>
            <tbody>
              <tr><td>읽은 파일</td><td>{result.files.join(', ')}</td></tr>
              <tr><td>대화 수</td><td>{s.conversations}</td></tr>
              <tr><td>사용자 발화 수</td><td>{s.userTurns}</td></tr>
              <tr><td>모델 응답 수</td><td>{s.assistantTurns}</td></tr>
              <tr><td>긴 대화(사용자 발화 10개 이상)</td><td>{s.longConversations}</td></tr>
              <tr><td>판단 가능 사용자 발화(2개 이상인 대화)</td><td>{s.judgeableUserTurns}</td></tr>
              <tr><td>사용자 발화 토큰 추정치</td><td>{s.userTokenEstimate}</td></tr>
              <tr><td>건너뛴 대화</td><td>{result.errors.length}</td></tr>
              <tr><td>정규화: ok / 제외 / context_required</td><td>{n.ok} / {n.skipped} / {n.context_required}</td></tr>
              <tr><td>정규화: 코드 포함 / 앞부분만 사용</td><td>{n.hasCode} / {n.truncated}</td></tr>
              <tr><td>versions</td><td>{result.parserVersion}, {result.normalizerVersion}</td></tr>
            </tbody>
          </table>
          {result.errors.length > 0 && <pre>{JSON.stringify(result.errors.slice(0, 20), null, 2)}</pre>}
          <h2>임베딩 속도 측정 (사용자 발화 100개)</h2>
          {MODELS.map((m) => (
            <p key={m}>{m}: <button onClick={() => runEmbed(m, 'wasm')}>wasm</button> <button onClick={() => runEmbed(m, 'webgpu')}>webgpu</button></p>
          ))}
          <pre>{embedLog.join('\n')}</pre>
        </section>
      )}
    </main>
  )
}
