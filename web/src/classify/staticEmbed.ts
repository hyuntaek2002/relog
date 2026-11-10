import { AutoTokenizer, type PreTrainedTokenizer } from '@huggingface/transformers'

// 정적 임베딩: 토크나이저로 자른 토큰마다 미리 계산된 벡터(e5-small에서 증류, eval/static/distill.mjs)를 찾아 평균한다.
// 모델 추론이 없어 수 MB 표만 있으면 되고 발화당 1ms 미만. 정확도는 문맥 모델보다 낮다(비교군).
export const STATIC_MODEL_ID = 'static-e5'
export const STATIC_SOURCE_TOKENIZER = 'Xenova/multilingual-e5-small'

export interface StaticMeta { version: string; source: string; dims: number; rows: number; builtAt: string }
export type FileLoader = (name: string) => Promise<ArrayBuffer>

export class StaticEmbedder {
  private rowOf = new Map<number, number>() // 토큰 id → 행
  meta: StaticMeta
  private vectors: Int8Array
  private scales: Float32Array
  private tokenizer: PreTrainedTokenizer
  private constructor(meta: StaticMeta, vectors: Int8Array, scales: Float32Array, ids: number[], tokenizer: PreTrainedTokenizer) {
    this.meta = meta; this.vectors = vectors; this.scales = scales; this.tokenizer = tokenizer
    ids.forEach((id, row) => this.rowOf.set(id, row))
  }

  // load(name)은 baseUrl 아래 파일을 ArrayBuffer로 준다(브라우저 fetch 또는 Node fs).
  static async load(load: FileLoader, tokenizer?: PreTrainedTokenizer): Promise<StaticEmbedder> {
    const [metaBuf, vec, sc, idsBuf] = await Promise.all([load('meta.json'), load('vectors.i8'), load('scales.f32'), load('ids.json')])
    const dec = new TextDecoder()
    const meta = JSON.parse(dec.decode(metaBuf)) as StaticMeta
    const ids = JSON.parse(dec.decode(idsBuf)) as number[]
    const tok = tokenizer ?? (await AutoTokenizer.from_pretrained(meta.source || STATIC_SOURCE_TOKENIZER))
    return new StaticEmbedder(meta, new Int8Array(vec), new Float32Array(sc), ids, tok)
  }

  get dim() { return this.meta.dims }

  async embed(texts: string[]): Promise<{ data: Float32Array; dim: number }> {
    const d = this.meta.dims
    const data = new Float32Array(texts.length * d)
    for (let t = 0; t < texts.length; t++) {
      // 문장마다 따로 토크나이즈(배치 패딩 없이 가변 길이). 토큰 조회+덧셈뿐이라 충분히 빠르다.
      const enc = this.tokenizer(texts[t], { add_special_tokens: false, truncation: true, max_length: 512 }) as { input_ids: { tolist(): (number | bigint)[][] } }
      const ids = enc.input_ids.tolist()[0]
      const row = data.subarray(t * d, (t + 1) * d)
      let n = 0
      for (const raw of ids) {
        const r = this.rowOf.get(Number(raw))
        if (r == null) continue
        const s = this.scales[r], base = r * d
        for (let k = 0; k < d; k++) row[k] += this.vectors[base + k] * s
        n++
      }
      let norm = 0
      for (let k = 0; k < d; k++) norm += row[k] * row[k]
      norm = Math.sqrt(norm) || 1
      for (let k = 0; k < d; k++) row[k] /= norm // n=0(알 수 없는 토큰뿐)이면 0벡터
      void n
    }
    return { data, dim: d }
  }
}

// 브라우저용 로더: public/static-e5/ 아래에서 받는다(Vite base 경로 포함)
export const browserLoader = (base = `${import.meta.env.BASE_URL}static-e5/`): FileLoader => async (name) => {
  const r = await fetch(base + name)
  if (!r.ok) throw new Error(`정적 임베딩 표를 받지 못함: ${name} ${r.status}`)
  return r.arrayBuffer()
}
