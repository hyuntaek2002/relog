// 추천 블라인드 평가 집계. 참여자들이 보낸 평가 파일(relog-eval-1)과 후속 파일(relog-eval-followup-1)을 한 폴더에 모아 두고 돌린다.
// 사용: node eval/ab/summarize.mjs <폴더>      예: node eval/ab/summarize.mjs exports/eval
// 출력은 숫자뿐이다. 참여자가 10~15명이라 탐색적 평가로만 보고한다(일반화하지 않음).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EVAL_FORMAT, FOLLOWUP_FORMAT, parseEvalFile, parseFollowupFile, summarizeEval } from '../../web/src/recommend/abEval.ts'

const dir = process.argv[2]
if (!dir) { console.error('사용: node eval/ab/summarize.mjs <평가 파일 폴더>'); process.exit(1) }
const evals = [], followups = [], skipped = []
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  const text = readFileSync(join(dir, name), 'utf8')
  try {
    const format = JSON.parse(text).format
    if (format === EVAL_FORMAT) evals.push(parseEvalFile(text))
    else if (format === FOLLOWUP_FORMAT) followups.push(parseFollowupFile(text))
    else skipped.push(name)
  } catch (e) { skipped.push(`${name} (${e.message})`) }
}
const s = summarizeEval(evals, followups)
const f = (x) => (x == null ? '-' : x.toFixed(2))
console.log(`참여자 ${s.participants}명 (후속 응답 ${followups.length}명)${skipped.length ? ` · 건너뛴 파일 ${skipped.length}개: ${skipped.join(', ')}` : ''}`)
console.log('\n참여자\t일반\t개인화\t둘 다\t차이(개인화−일반)')
for (const p of s.perParticipant) console.log(`${p.participant}\t${f(p.generic)}\t${f(p.personalized)}\t${f(p.both)}\t${f(p.diff)}`)
console.log(`\n평균 관련성: 일반 ${f(s.meanGeneric)} · 개인화 ${f(s.meanPersonalized)}`)
console.log(`개인화가 높은 참여자 ${s.preferPersonalized}명 · 일반이 높은 참여자 ${s.preferGeneric}명 · 같음 ${s.ties}명 · 부호 검정 p=${s.signTestP.toFixed(3)}`)
const u = (k) => (s.usage[k].total ? `${s.usage[k].used}/${s.usage[k].total} (${Math.round((100 * s.usage[k].used) / s.usage[k].total)}%)` : '-')
console.log(`1주 뒤 실제 사용: 일반 ${u('generic')} · 개인화 ${u('personalized')} · 둘 다 ${u('both')}`)
