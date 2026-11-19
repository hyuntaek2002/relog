// 임베딩 모델별 설정(측정용). 모델마다 앞에 붙이는 말(prefix)과 문장 벡터를 뽑는 방식(pooling)이 다르다.
// 각 모델 카드의 권장 사용법을 따른다. 분류용으로 쓰므로 "질의" 쪽 형식을 쓴다.
import { pipeline, AutoModel, AutoTokenizer } from '../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'

export const MODEL_CONFIG = {
  'Xenova/multilingual-e5-small': { prefix: 'query: ', pooling: 'mean' },
  'Xenova/multilingual-e5-large': { prefix: 'query: ', pooling: 'mean' },
  'Xenova/bge-m3': { prefix: '', pooling: 'cls' },
  'Snowflake/snowflake-arctic-embed-l-v2.0': { prefix: 'query: ', pooling: 'cls' },
  'Snowflake/snowflake-arctic-embed-m-v2.0': { prefix: 'query: ', pooling: 'cls' },
  // EmbeddingGemma: 평균 뒤에 Dense 층이 있어 파이프라인 대신 모델의 sentence_embedding 출력을 쓴다
  'onnx-community/embeddinggemma-300m-ONNX': { prefix: 'task: classification | query: ', sentenceEmbedding: true },
  // Qwen3-Embedding: 지시문 + 마지막 토큰
  'onnx-community/Qwen3-Embedding-0.6B-ONNX': { prefix: 'Instruct: Classify the type of task the user is asking an AI assistant to do\nQuery:', pooling: 'last_token' },
}

/** (texts) => number[][] (L2 정규화). 배치 크기는 호출 측이 정한다. */
export async function makeEmbedder(model, dtype = 'q8') {
  const cfg = MODEL_CONFIG[model] ?? { prefix: 'query: ', pooling: 'mean' }
  if (cfg.sentenceEmbedding) {
    const tok = await AutoTokenizer.from_pretrained(model)
    const m = await AutoModel.from_pretrained(model, { dtype })
    return async (texts) => {
      const inputs = await tok(texts.map((t) => cfg.prefix + t), { padding: true, truncation: true, max_length: 512 })
      const { sentence_embedding: e } = await m(inputs)
      const d = e.dims[1]
      return texts.map((_, k) => normalize(Array.from(e.data.slice(k * d, (k + 1) * d))))
    }
  }
  const pipe = await pipeline('feature-extraction', model, { dtype })
  return async (texts) => {
    const o = await pipe(texts.map((t) => cfg.prefix + t), { pooling: cfg.pooling, normalize: true })
    const d = o.dims[1]
    return texts.map((_, k) => Array.from(o.data.slice(k * d, (k + 1) * d)))
  }
}

function normalize(v) {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}
