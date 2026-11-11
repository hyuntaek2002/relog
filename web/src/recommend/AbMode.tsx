import { useMemo, useState } from 'react'
import { CATALOG, genericDefaults, type Platform, type Prescription, type UserContext } from './recommend'
import { buildCards, buildEvalFile, FOLLOWUP_FORMAT, parseEvalFile, SOURCE_LABEL, type EvalFile, type FollowupFile } from './abEval'
import { buildReport } from '../store/report'
import type { AnalysisVersion, PeriodSnapshot } from '../store/ledger'
import type { UsageSnapshot } from './snapshot'
import Help from '../ui/Help'

// 추천 블라인드 평가(?ab=1): 일반 추천(인기 3개)과 개인화 추천을 섞어 무작위 순서로 보여 주고 관련성 1~5점을 받는다.
// 결과는 파일로만 저장한다(참여자 번호·점수·순서·요금제·쓰는 기능·주 단위 집계 숫자). 어디로도 보내지 않는다.
const steps = (how: string) => how.split(/\s*\d\)\s*/).map((s) => s.trim()).filter(Boolean)
const save = (name: string, data: unknown) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })), download: name })
  a.click()
  URL.revokeObjectURL(a.href)
}

export default function AbMode({ platform, personalized, snapshot, weeks, version, ctx }: { platform: Platform; personalized: Prescription[]; snapshot: UsageSnapshot | null; weeks: PeriodSnapshot[]; version: AnalysisVersion | null; ctx: UserContext | null }) {
  const [seed] = useState(() => Date.now()) // 한 번만 정한다: 점수를 매기는 동안 순서가 바뀌면 안 된다
  const ids = personalized.map((p) => p.catalogId).join(',')
  // 추천 목록의 내용(id)이 같으면 다시 섞지 않는다. personalized 배열은 렌더마다 새로 만들어지므로 id 문자열로 비교한다.
  const cards = useMemo(() => buildCards(genericDefaults(platform), personalized, seed), [platform, ids, seed]) // eslint-disable-line react-hooks/exhaustive-deps
  const [participant, setParticipant] = useState('')
  const [scores, setScores] = useState<Record<string, number>>({})
  const [revealed, setRevealed] = useState(false)
  const done = cards.length > 0 && cards.every((c) => scores[c.catalogId])

  function exportEval() {
    const report = snapshot && version ? buildReport(snapshot, weeks, version) : null
    const file = buildEvalFile({ participant, platform, plan: ctx?.plan ?? '', featuresInUse: ctx?.featuresInUse ?? [], cards, scores, report })
    save(`relog-평가-${file.participant}-${file.exportedAt.slice(0, 10)}.json`, file)
    setRevealed(true)
  }

  return (
    <div>
      <p className="detail">
        카드마다 "나와 관련 있다"를 1(전혀 아님)~5(매우 그렇다)로 매겨 주세요.
        <Help text="일반 추천과 내 대화 패턴에 맞춘 추천이 섞여 있습니다. 어느 쪽인지는 저장한 뒤에 보입니다. 저장 파일에는 참여자 번호, 점수, 카드 순서, 요금제, 쓰는 기능, 주 단위 집계 숫자만 들어가고 대화 내용은 없습니다." />
      </p>
      {cards.map((c) => (
        <div className="rx" key={c.catalogId}>
          <div className="meta"><b>{c.name}</b>{revealed && <span className="tag">{SOURCE_LABEL[c.source]}</span>}</div>
          <p className="lead">{c.what}</p>
          <ol className="rx-steps">{steps(c.how).map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p className="actions">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} disabled={revealed} className={scores[c.catalogId] === n ? 'on' : ''} onClick={() => setScores((s) => ({ ...s, [c.catalogId]: n }))}>{n}</button>
            ))}
          </p>
        </div>
      ))}
      <p className="actions">
        <input placeholder="참여자 번호" value={participant} onChange={(e) => setParticipant(e.target.value)} style={{ width: 120 }} />{' '}
        <button disabled={!done || !participant.trim() || revealed} onClick={exportEval}>평가 파일 저장</button>
        {!revealed && (!done || !participant.trim()) && <span className="detail"> 모든 카드에 점수를 매기고 참여자 번호를 적으면 저장할 수 있습니다.</span>}
        {revealed && <span className="detail"> 저장했습니다. 받은 파일을 담당자에게 전달해 주세요.</span>}
      </p>
      <Followup />
    </div>
  )
}

// 1주 뒤: 저장해 둔 평가 파일을 올려 추천받은 기능을 실제로 써 봤는지 답한다(관련성 점수와 따로 수집).
function Followup() {
  const [file, setFile] = useState<EvalFile | null>(null)
  const [used, setUsed] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const nameOf = (id: string) => CATALOG.find((c) => c.id === id)?.name ?? id
  async function load(f: File | undefined) {
    if (!f) return
    try { setFile(parseEvalFile(await f.text())); setUsed({}); setErr(''); setSaved(false) } catch (e) { setFile(null); setErr((e as Error).message) }
  }
  function exportFollowup() {
    if (!file) return
    const out: FollowupFile = { format: FOLLOWUP_FORMAT, participant: file.participant, exportedAt: new Date().toISOString(), evaluatedAt: file.exportedAt, items: file.cards.map((c) => ({ catalogId: c.catalogId, source: c.source, used: used[c.catalogId] })) }
    save(`relog-후속-${out.participant}-${out.exportedAt.slice(0, 10)}.json`, out)
    setSaved(true)
  }
  const done = !!file && file.cards.every((c) => typeof used[c.catalogId] === 'boolean')
  return (
    <details className="plugin-search">
      <summary>1주 뒤: 실제로 써 봤는지 답하기</summary>
      <p className="actions"><label className="btn">평가 파일 올리기<input type="file" accept=".json,application/json" onChange={(e) => load(e.target.files?.[0])} /></label></p>
      {err && <p className="err">{err}</p>}
      {file && (
        <>
          <p className="detail">참여자 {file.participant} · {file.exportedAt.slice(0, 10)} 평가. 그 뒤로 써 본 기능에 "예"를 눌러 주세요.</p>
          <ul className="ps-list">
            {file.cards.map((c) => (
              <li key={c.catalogId}>
                <b>{nameOf(c.catalogId)}</b>{' '}
                <button className={used[c.catalogId] === true ? 'on' : ''} onClick={() => setUsed((u) => ({ ...u, [c.catalogId]: true }))}>예</button>
                <button className={used[c.catalogId] === false ? 'on' : ''} onClick={() => setUsed((u) => ({ ...u, [c.catalogId]: false }))}>아니요</button>
              </li>
            ))}
          </ul>
          <button disabled={!done} onClick={exportFollowup}>후속 파일 저장</button>
          {saved && <span className="detail"> 저장했습니다. 받은 파일을 담당자에게 전달해 주세요.</span>}
        </>
      )}
    </details>
  )
}
