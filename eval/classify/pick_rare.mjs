// 표본이 적은 유형(업무 문서·기획) 보강: 큰 표본(pool)에서 그 유형일 법한 발화만 후보로 추려 사람이 읽을 수 있게 한다.
// 후보 = 현재 분류기(D)가 그 유형에 확률을 꽤 준 발화 ∪ 그 유형의 낱말이 든 발화. 무작위 표본이 아니라는 점은 보고할 때 밝혀야 한다.
// 사용:
//   1) 후보 뽑기:  node eval/classify/pick_rare.mjs exports/public/wildchat-ko-pool.zip
//        → exports/public/rare-candidates.json (원문 포함, 저장소 제외)
//   2) 확정 묶기:  node eval/classify/pick_rare.mjs exports/public/wildchat-ko-pool.zip <messageId,type 줄이 든 CSV>
//        → exports/public/wildchat-ko-rare.zip(그 발화가 든 대화만) + eval/labels/wildchat-ko-rare.suggested.csv(id와 유형만)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync, strToU8 } from '../../web/node_modules/fflate/esm/index.mjs'
import { parseConversationsJson } from '../../web/src/parser/chatgpt.ts'
import { normalizeConversations } from '../../web/src/parser/normalize.ts'
import { LABELED, SEED_TEXTS, SEED_TYPES, TaskClassifier } from '../../web/src/classify/classifier.ts'

const RARE = ['work_doc', 'ideation']
const WORDS = /보고서|계획서|기획서|제안서|회의록|이력서|자기소개서|자소서|공문|품의|메일|이메일|발표 ?자료|ppt|기획|아이디어|브레인스토밍|일정|전략|로드맵|사업|창업|마케팅|컨셉|콘셉트|네이밍|이름 ?(지어|추천)/i
const here = dirname(fileURLToPath(import.meta.url))
const [zipPath, pickedCsv] = process.argv.slice(2)
const raw = JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(readFileSync(zipPath)))['conversations.json']))
const utts = normalizeConversations(parseConversationsJson(raw).conversations).filter((u) => u.status === 'ok')

if (pickedCsv) {
  const picked = new Map(readFileSync(pickedCsv, 'utf8').split('\n').map((l) => l.trim().split(',')).filter(([m, t]) => m && t))
  const convOf = new Map(utts.map((u) => [u.messageId, u.conversationId]))
  const keep = new Set([...picked.keys()].map((m) => convOf.get(m)).filter(Boolean))
  const rows = utts.filter((u) => picked.has(u.messageId)).map((u) => `${u.conversationId},${u.messageId},${picked.get(u.messageId)}`)
  writeFileSync(join(here, '../../exports/public/wildchat-ko-rare.zip'), zipSync({ 'conversations.json': strToU8(JSON.stringify(raw.filter((c) => keep.has(c.id)))) }))
  writeFileSync(join(here, '../labels/wildchat-ko-rare.suggested.csv'), 'conversationId,messageId,type\n' + rows.join('\n') + '\n')
  console.log({ conversations: keep.size, suggested: rows.length })
} else {
  const { pipeline } = await import('../../web/node_modules/@huggingface/transformers/dist/transformers.node.mjs')
  const pipe = await pipeline('feature-extraction', LABELED.model, { dtype: 'q8' })
  const dim = LABELED.dim
  async function embed(texts) {
    const out = []
    for (let i = 0; i < texts.length; i += 32) {
      const batch = texts.slice(i, i + 32)
      const o = await pipe(batch.map((t) => 'query: ' + t), { pooling: 'mean', normalize: true })
      batch.forEach((_, k) => out.push(o.data.slice(k * dim, (k + 1) * dim)))
    }
    return out
  }
  const lin = LABELED.linear
  const prob = (v) => { // 유형별 소프트맥스 확률
    const z = lin.b.map((b, k) => { let s = b; for (let d = 0; d < dim; d++) s += lin.W[k][d] * v[d]; return s })
    const mx = Math.max(...z), e = z.map((x) => Math.exp(x - mx)), Z = e.reduce((a, b) => a + b, 0)
    return Object.fromEntries(lin.classes.map((c, k) => [c, e[k] / Z]))
  }
  const clf = new TaskClassifier(await embed(SEED_TEXTS), SEED_TYPES, undefined, LABELED)
  const vecs = await embed(utts.map((u) => u.text))
  const cands = []
  utts.forEach((u, i) => {
    const p = prob(vecs[i])
    const score = Math.max(...RARE.map((t) => p[t]))
    const word = WORDS.test(u.text)
    if (score >= 0.2 || word) cands.push({ messageId: u.messageId, pred: clf.linear(vecs[i]).type, score: Math.round(score * 100) / 100, word, text: u.text })
  })
  cands.sort((a, b) => b.score - a.score)
  writeFileSync(join(here, '../../exports/public/rare-candidates.json'), JSON.stringify(cands))
  console.log({ pool: utts.length, candidates: cands.length, byScore: cands.filter((c) => c.score >= 0.2).length, byWordOnly: cands.filter((c) => c.score < 0.2).length })
}
