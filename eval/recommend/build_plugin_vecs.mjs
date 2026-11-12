// 플러그인 설명 임베딩을 미리 계산한다(대화-플러그인 맞춤 평가용: eval_match.mjs, task_picks.mjs).
// 사용: node eval/recommend/build_plugin_vecs.mjs <ChatGPT 목록 원본 JSON> <기준 메시지 캐시 접두어>
//   ChatGPT 목록 원본: chatgpt.com/plugins 카테고리 화면에서 모은 {id: {name, desc, cats: [[slug, 순위]]}}
//   기준 메시지 캐시: eval/detect/cache_embed.mjs 결과(공개 WildChat 표본). 플러그인마다 "평소 유사도" 평균·표준편차를 잰다.
// 출력(exports/plugin-match, 저장소 제외 · 제품에는 넣지 않음): plugins-claude-2026-11-10.json(m·d를 더한 사본), plugins-chatgpt-<날짜>.json, plugin-vecs-<플랫폼>-<날짜>.bin(int8, 행 = 플러그인, 384차원)
//   각 목록 항목에 m(평소 유사도 평균), d(표준편차)를 넣는다. 점수 = (유사도 − m) / d.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pipeline } from '../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'

const [cgRaw, refPrefix] = process.argv.slice(2)
const DATE = '2026-11-12'
const pub = new URL('../../exports/plugin-match/', import.meta.url)
mkdirSync(pub, { recursive: true })
const pipe = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' })

async function embed(texts) {
  let dim = 0, out = null
  for (let s = 0; s < texts.length; s += 32) {
    const o = await pipe(texts.slice(s, s + 32), { pooling: 'mean', normalize: true })
    dim = o.dims[1]
    out ??= new Float32Array(texts.length * dim)
    out.set(o.data, s * dim)
  }
  return { dim, data: out }
}

// 기준 메시지(공개 표본): 플러그인별 평소 유사도
const ref = JSON.parse(readFileSync(refPrefix + '.json', 'utf8'))
const rb = readFileSync(refPrefix + '.f32')
const refVecs = new Float32Array(rb.buffer, rb.byteOffset, rb.byteLength / 4)
const nRef = ref.inputs.length

function finish(platform, list, texts) {
  return embed(texts).then(({ dim, data }) => {
    const q = new Int8Array(list.length * dim)
    for (let i = 0; i < list.length; i++) {
      const v = data.subarray(i * dim, (i + 1) * dim)
      // 평소 유사도: 기준 메시지 전부와의 코사인 평균·표준편차
      let s = 0, s2 = 0
      for (let r = 0; r < nRef; r++) {
        let d = 0
        for (let k = 0; k < dim; k++) d += v[k] * refVecs[r * dim + k]
        s += d; s2 += d * d
      }
      const m = s / nRef
      list[i].m = Math.round(m * 1e4) / 1e4
      list[i].d = Math.round(Math.sqrt(Math.max(1e-8, s2 / nRef - m * m)) * 1e4) / 1e4
      for (let k = 0; k < dim; k++) q[i * dim + k] = Math.max(-127, Math.min(127, Math.round(v[k] * 127 / 0.25))) // 정규화 벡터의 성분은 대개 ±0.25 안
    }
    writeFileSync(new URL(`plugin-vecs-${platform}-${DATE}.bin`, pub), Buffer.from(q.buffer))
    console.log(platform, list.length, 'dim', dim)
  })
}

// ChatGPT: 이름·한 줄 설명. 순위는 카테고리 화면의 노출 순서 중 가장 앞(인기·추천 순으로 보임)
const raw = JSON.parse(readFileSync(cgRaw, 'utf8'))
const cg = Object.entries(raw).map(([id, x]) => ({ id, n: x.name, s: x.desc, c: x.cats.map(([c]) => c), r: Math.min(...x.cats.map(([, r]) => r)) }))
await finish('chatgpt', cg, cg.map((p) => `passage: ${p.n}: ${p.s}`))
writeFileSync(new URL(`plugins-chatgpt-${DATE}.json`, pub), JSON.stringify({ format: 'relog-plugins-cg-1', fetchedAt: DATE, note: 'chatgpt.com/plugins 카테고리 화면에서 모음. r = 카테고리 화면 노출 순서 중 가장 앞. m·d = 공개 표본 메시지와의 평소 유사도 평균·표준편차', plugins: cg }))

// Claude: 기존 목록 파일에 m·d를 더해 같은 순서로 벡터를 만든다
const clFile = new URL('../../web/public/plugins-2026-11-10.json', import.meta.url)
const cl = JSON.parse(readFileSync(clFile, 'utf8'))
await finish('claude', cl.plugins, cl.plugins.map((p) => `passage: ${p.n}: ${p.s}${p.k ? ' ' + p.k : ''}`))
writeFileSync(new URL('plugins-claude-2026-11-10.json', pub), JSON.stringify(cl))
