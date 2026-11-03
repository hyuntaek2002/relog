import { CATALOG, scoreAll, type FeedbackMap, type UserContext } from './recommend'
import type { UsageSnapshot } from './snapshot'

// 개발 패널: 전체 카탈로그 점수표(탈락 사유 포함) + 검증 상태
export default function RecommendDev({ snapshot, ctx, feedback }: { snapshot: UsageSnapshot; ctx: UserContext; feedback: FeedbackMap }) {
  const rows = scoreAll(snapshot, ctx, feedback).sort((a, b) => b.score - a.score)
  return (
    <div>
      <table className="dev">
        <thead><tr><th>id</th><th>점수</th><th>문제 신호</th><th>과업 신호</th><th>탈락</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item.id} className={r.excluded ? 'muted' : ''}>
              <td>{r.item.id}</td><td>{r.score.toFixed(2)}</td><td>{r.problemHits.join(', ')}</td><td>{r.taskHits.join(', ')}</td><td>{r.excluded ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>개발: 카탈로그 검증 상태</h2>
      <table className="dev">
        <thead><tr><th>id</th><th>verified</th><th>verifiedAt</th><th>evidenceUrl</th></tr></thead>
        <tbody>
          {CATALOG.map((c) => (
            <tr key={c.id} className={c.verified ? '' : 'muted'}>
              <td>{c.id}</td><td>{String(c.verified)}</td><td>{c.verifiedAt}</td><td>{c.evidenceUrl && <a href={c.evidenceUrl} target="_blank" rel="noreferrer">{c.evidenceUrl.replace(/^https?:\/\//, '').slice(0, 60)}</a>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="detail">스냅샷: {JSON.stringify({ ...snapshot, hourHistogram: undefined })}</p>
    </div>
  )
}
