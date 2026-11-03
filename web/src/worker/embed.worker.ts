import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers'

// 모델은 1회 다운로드 후 Cache Storage에 캐시된다(transformers.js 기본 동작).
env.allowLocalModels = false

// 배치 안에서 가장 긴 문장 길이로 패딩되므로 작은 배치가 유리. 길이순 정렬은 다음 단계에서.
const BATCH = 16

export type EmbedIn = { type: 'embed'; model: string; device: 'wasm' | 'webgpu'; texts: string[] }
export type EmbedOut =
  | { type: 'download'; file: string; percent: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; loadMs: number; embedMs: number; count: number; dim: number }
  | { type: 'error'; message: string }

self.onmessage = async (e: MessageEvent<EmbedIn>) => {
  const { model, device, texts } = e.data
  const post = (m: EmbedOut) => self.postMessage(m)
  try {
    const t0 = performance.now()
    const pipe = (await pipeline('feature-extraction', model, {
      dtype: 'q8',
      device,
      progress_callback: (p: { status: string; file?: string; progress?: number }) => {
        if (p.status === 'progress' && p.file) post({ type: 'download', file: p.file, percent: Math.round(p.progress ?? 0) })
      },
    })) as FeatureExtractionPipeline
    const loadMs = Math.round(performance.now() - t0)

    // E5 계열은 "query: " 접두어 필수
    const inputs = model.includes('e5') ? texts.map((t) => 'query: ' + t) : texts
    const t1 = performance.now()
    let dim = 0
    for (let i = 0; i < inputs.length; i += BATCH) {
      const out = await pipe(inputs.slice(i, i + BATCH), { pooling: 'mean', normalize: true })
      dim = out.dims[1]
      post({ type: 'progress', done: Math.min(i + BATCH, inputs.length), total: inputs.length })
    }
    const embedMs = Math.round(performance.now() - t1)
    post({ type: 'done', loadMs, embedMs, count: texts.length, dim })
  } catch (err) {
    post({ type: 'error', message: (err as Error).message })
  }
}
