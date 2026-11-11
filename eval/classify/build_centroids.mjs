// 라벨된 공개 표본으로 제품에 넣을 분류 자료를 만든다(web/src/classify/labeled-centroids.json).
//   sums:   대화 종류별 "임베딩 합". 제품의 중심점 분류(B)는 예시 발화의 임베딩 합에 이 합을 더해 중심점을 만든다. 기타는 이 합만으로 중심점이 된다.
//   linear: 선형 분류기(D) 가중치. 예시 발화 + 라벨 표본 전체로 학습한다(비교 실험의 "예시+학습" 설정, linear.mjs).
// 파일에는 숫자와 건수만 들어간다. 표본 원문은 들어가지 않는다.
// 사용: node eval/classify/build_centroids.mjs exports/public/wildchat-ko-400.zip eval/labels/wildchat-ko-400.labels.csv [보강 zip 보강 라벨 CSV …]
//   zip·CSV 쌍을 더 주면 그 라벨도 함께 쓴다(표본이 적은 유형 보강분, pick_rare.mjs)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from '../../web/node_modules/fflate/esm/index.mjs'
import { pipeline } from '../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'
import { parseConversationsJson } from '../../web/src/parser/chatgpt.ts'
import { normalizeConversations } from '../../web/src/parser/normalize.ts'
import { SEED_TEXTS, SEED_TYPES, TASK_TYPES } from '../../web/src/classify/classifier.ts'
import { trainLinear } from './linear.mjs'

const argv = process.argv.slice(2)
const MODEL = 'Xenova/multilingual-e5-small'
const L2 = 1e-2 // 교차 검증의 안쪽 분할에서 가장 자주 골라진 값(docs/measurements.md)
const CLASSES = [...TASK_TYPES, 'other'] // 문맥 필요는 분류 대상이 아니다
const here = dirname(fileURLToPath(import.meta.url))
const items = []
for (let a = 0; a + 1 < argv.length; a += 2) {
  const files = unzipSync(new Uint8Array(readFileSync(argv[a])))
  const convs = Object.entries(files).filter(([n]) => /conversations[^/]*\.json$/i.test(n)).flatMap(([, b]) => parseConversationsJson(JSON.parse(new TextDecoder().decode(b))).conversations)
  const textById = new Map(normalizeConversations(convs).map((u) => [u.messageId, u.text]))
  for (const line of readFileSync(argv[a + 1], 'utf8').split('\n').slice(1)) {
    const [, messageId, type] = line.trim().split(',')
    if (!CLASSES.includes(type)) continue
    const text = textById.get(messageId)
    if (text) items.push({ text, type })
  }
}
const pipe = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
const dim = 384
async function embed(texts) {
  const out = []
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32)
    const o = await pipe(batch.map((t) => 'query: ' + t), { pooling: 'mean', normalize: true })
    batch.forEach((_, k) => out.push(o.data.slice(k * dim, (k + 1) * dim)))
  }
  return out
}
const vecs = await embed(items.map((x) => x.text))
const seedVecs = await embed(SEED_TEXTS)
const sums = Object.fromEntries(CLASSES.map((t) => [t, new Float64Array(dim)]))
const counts = Object.fromEntries(CLASSES.map((t) => [t, 0]))
items.forEach((x, i) => { counts[x.type]++; for (let d = 0; d < dim; d++) sums[x.type][d] += vecs[i][d] })
const lin = trainLinear([...seedVecs, ...vecs], [...SEED_TYPES, ...items.map((x) => x.type)], { l2: L2 })
const r4 = (v) => Math.round(v * 1e4) / 1e4
const file = {
  version: 'labeled-0.2.0',
  model: MODEL,
  dim,
  source: 'WildChat-1M 한국어 표본(eval/labels/wildchat-ko-400.labels.csv, AI 제안 후 사람 확인 라벨)의 유형별 임베딩 합과, 예시 발화 + 그 표본으로 학습한 선형 분류기 가중치. 원문 없음.',
  counts,
  sums: Object.fromEntries(CLASSES.map((t) => [t, Array.from(sums[t], r4)])),
  linear: { classes: lin.classes, W: lin.W.map((r) => r.map(r4)), b: lin.b.map(r4) },
}
const dest = join(here, '../../web/src/classify/labeled-centroids.json')
writeFileSync(dest, JSON.stringify(file))
console.log({ items: items.length, counts, classes: lin.classes, bytes: JSON.stringify(file).length, dest })
