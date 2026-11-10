import { CATALOG, scoreAll, type FeedbackMap, type UserContext } from './recommend'
import { SNAPSHOT_TASKS, type SnapshotTask, type UsageSnapshot } from './snapshot'

// 개발 패널: 카탈로그 전 항목 점수표(뺀 이유 포함) + 항목 확인 상태 + 추천 엔진 입력값
const TASK: Record<SnapshotTask, string> = { coding: '코딩', writing: '글쓰기·교정', learning: '학습·설명', workdoc: '업무 문서', search: '정보 탐색', ideation: '아이디어·기획', translation: '번역', counseling: '상담·대화' }
const pct = (v: number) => `${Math.round(v * 100)}%`

export default function RecommendDev({ snapshot, ctx, feedback }: { snapshot: UsageSnapshot; ctx: UserContext; feedback: FeedbackMap }) {
  const rows = scoreAll(snapshot, ctx, feedback).sort((a, b) => b.score - a.score)
  const r = snapshot.restatement
  return (
    <div>
      <p className="detail">
        추천 카드 3장을 고르려고 카탈로그 {CATALOG.length}개 항목 전부에 매긴 점수입니다. 점수가 높은 순서로, 종류(기능·플러그인·습관 등)당 최대 2개까지 카드로 나갑니다.
        <br />점수 = 맞은 문제 신호의 가중치×2 + 맞은 대화 종류의 가중치 + 항목 기본 우선순위÷100 + 내 피드백(도움됨 +1, 아님 −2).
        <br />문제 신호 = 다시 말한 지시·긴 대화 비율처럼 "불편이 있었다"는 숫자. 대화 종류 = 그 항목이 겨냥한 대화 종류의 비중이 기준 이상인지. 뺀 이유가 있는 항목은 점수와 상관없이 추천하지 않습니다.
      </p>
      <table className="dev">
        <thead><tr><th>항목</th><th>점수</th><th>맞은 문제 신호</th><th>맞은 대화 종류</th><th>추천에서 뺀 이유</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.item.id} className={x.excluded ? 'muted' : ''}>
              <td title={x.item.id}>{x.item.name}</td><td>{x.score.toFixed(2)}</td><td>{x.problemHits.join(', ')}</td><td>{x.taskHits.join(', ')}</td><td>{x.excluded ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>개발: 추천 항목 확인 상태</h2>
      <p className="detail">각 항목이 지금도 실제로 있는 기능인지 공식 도움말이나 앱 화면에서 확인한 기록입니다. 근거 = 확인에 쓴 도움말 페이지 주소(앱 화면으로 확인한 항목은 비어 있음). 확인 안 된 항목은 추천에 나가지 않습니다.</p>
      <table className="dev">
        <thead><tr><th>항목</th><th>확인됨</th><th>확인한 날</th><th>근거</th></tr></thead>
        <tbody>
          {CATALOG.map((c) => (
            <tr key={c.id} className={c.verified ? '' : 'muted'}>
              <td title={c.id}>{c.name}</td><td>{c.verified ? '예' : '아니요'}</td><td>{c.verifiedAt}</td><td>{c.evidenceUrl && <a href={c.evidenceUrl} target="_blank" rel="noreferrer">{c.evidenceUrl.replace(/^https?:\/\//, '').slice(0, 60)}</a>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>개발: 추천 엔진에 들어간 숫자</h2>
      <p className="detail">내 파일에서 뽑은 숫자 요약입니다. 추천 점수는 이 값만 보고 계산하고, 서버 동기화를 켜면 이 수준의 숫자만 보냅니다. 대화 내용은 들어 있지 않습니다.</p>
      <table className="dev">
        <tbody>
          <tr><td>플랫폼</td><td>{snapshot.platform}</td></tr>
          <tr><td>대화 수 / 내 메시지 수</td><td>{snapshot.conversationCount} / {snapshot.userTurnCount}</td></tr>
          <tr><td>긴 대화 비율 (메시지 10개 초과)</td><td>{pct(snapshot.longConversationShare)}</td></tr>
          <tr><td>대화당 평균 내 메시지</td><td>{snapshot.avgTurnsPerConversation.toFixed(1)}</td></tr>
          <tr><td>코드 포함 메시지 비율</td><td>{pct(snapshot.codeShare)}</td></tr>
          <tr><td>대화 종류별 내 메시지 수 (비율)</td><td>{SNAPSHOT_TASKS.filter((t) => snapshot.taskCounts[t] > 0).map((t) => `${TASK[t]} ${snapshot.taskCounts[t]} (${pct(snapshot.taskShare[t])})`).join(' · ')}</td></tr>
          <tr><td>다시 말한 지시: 확실함 / 가능성 있음 / 약함</td><td>{r.high} / {r.mid} / {r.low}</td></tr>
          <tr><td>대화 종류별 다시 말한 지시</td><td>{Object.entries(r.perTask).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([t, n]) => `${TASK[t as SnapshotTask] ?? t} ${n}`).join(' · ') || '없음'}</td></tr>
          <tr><td>말이 안 통한 듯한 표현 / 비슷한 질문 다시 함</td><td>{r.misunderstanding} / {r.repeatedQuestion}</td></tr>
          <tr><td>다시 입력한 분량 (토큰 추정) / 내 메시지 대비</td><td>{r.tokenEstimate.toLocaleString()} / {r.ratio.toFixed(1)}%</td></tr>
        </tbody>
      </table>
      <details><summary className="detail">원본 JSON</summary><pre>{JSON.stringify({ ...snapshot, hourHistogram: undefined }, null, 1)}</pre></details>
    </div>
  )
}
