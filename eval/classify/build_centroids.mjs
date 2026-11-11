// 라벨된 공개 표본으로 대화 종류별 "임베딩 합"을 계산해 제품에 넣을 파일을 만든다.
// 제품의 중심점 분류(B)는 예시 발화의 임베딩 합에 이 합을 더해 중심점을 만든다 = 비교 실험의 "예시+학습" 설정.
// 파일에는 유형별 384차원 숫자와 건수만 들어간다. 표본 원문은 들어가지 않는다.
// 사용: node eval/classify/build_centroids.mjs exports/public/wildchat-ko-400.zip eval/labels/wildchat-ko-400.labels.csv
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from '../../web/node_modules/fflate/esm/index.mjs'
import { pipeline } from '../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'
import { parseConversationsJson } from '../../web/src/parser/chatgpt.ts'
import { normalizeConversations } from '../../web/src/parser/normalize.ts'
import { TASK_TYPES } from '../../web/src/classify/classifier.ts'

const [zipPath, csvPath] = process.argv.slice(2)
const MODEL = 'Xenova/multilingual-e5-small'
const here = dirname(fileURLToPath(import.meta.url))
const files = unzipSync(new Uint8Array(readFileSync(zipPath)))
const convs = Object.entries(files).filter(([n]) => /conversations[^/]*\.json$/i.test(n)).flatMap(([, b]) => parseConversationsJson(JSON.parse(new TextDecoder().decode(b))).conversations)
const textById = new Map(normalizeConversations(convs).map((u) => [u.messageId, u.text]))
const items = []
for (const line of readFileSync(csvPath, 'utf8').split('\n').slice(1)) {
  const [, messageId, type] = line.trim().split(',')
  if (!TASK_TYPES.includes(type)) continue // 기타·문맥 필요는 중심점을 만들지 않는다
  const text = textById.get(messageId)
  if (text) items.push({ text, type })
}
const pipe = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
const dim = 384
const sums = Object.fromEntries(TASK_TYPES.map((t) => [t, new Float64Array(dim)]))
const counts = Object.fromEntries(TASK_TYPES.map((t) => [t, 0]))
for (let i = 0; i < items.length; i += 32) {
  const batch = items.slice(i, i + 32)
  const out = await pipe(batch.map((x) => 'query: ' + x.text), { pooling: 'mean', normalize: true })
  batch.forEach((x, k) => { counts[x.type]++; for (let d = 0; d < dim; d++) sums[x.type][d] += out.data[k * dim + d] })
}
const file = {
  version: 'labeled-0.1.0',
  model: MODEL,
  dim,
  source: 'WildChat-1M 한국어 표본(eval/labels/wildchat-ko-400.labels.csv, AI 제안 후 사람 확인 라벨)의 유형별 임베딩 합. 원문 없음.',
  counts,
  sums: Object.fromEntries(TASK_TYPES.map((t) => [t, Array.from(sums[t], (v) => Math.round(v * 1e4) / 1e4)])),
}
const dest = join(here, '../../web/src/classify/labeled-centroids.json')
writeFileSync(dest, JSON.stringify(file))
console.log({ items: items.length, counts, bytes: JSON.stringify(file).length, dest })
