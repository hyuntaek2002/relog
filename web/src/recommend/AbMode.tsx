import { useMemo, useState } from 'react'
import { genericDefaults, type CatalogItem, type Platform, type Prescription } from './recommend'

// A/B 평가(?ab=1): 일반 추천(인기 3개) vs 개인화 추천을 섞어 블라인드로 제시. 관련성 1~5점.
type Source = 'generic' | 'personalized' | 'both'
interface Card { catalogId: string; name: string; what: string; how: string; source: Source; order: number }

function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs]
  let s = seed >>> 0
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function AbMode({ platform, personalized }: { platform: Platform; personalized: Prescription[] }) {
  const cards = useMemo<Card[]>(() => {
    const generic: CatalogItem[] = genericDefaults(platform)
    const map = new Map<string, Card>()
    for (const g of generic) map.set(g.id, { catalogId: g.id, name: g.name, what: g.oneLiner, how: g.howTo30s, source: 'generic', order: 0 })
    for (const p of personalized) {
      const prev = map.get(p.catalogId)
      if (prev) prev.source = 'both'
      else map.set(p.catalogId, { catalogId: p.catalogId, name: p.name, what: p.what, how: p.how, source: 'personalized', order: 0 })
    }
    return shuffle([...map.values()], Date.now()).map((c, i) => ({ ...c, order: i + 1 }))
  }, [platform, personalized])
  const [scores, setScores] = useState<Record<string, number>>({})
  const [revealed, setRevealed] = useState(false)
  const done = cards.every((c) => scores[c.catalogId])

  function exportCsv() {
    const rows = cards.map((c) => `${c.catalogId},${c.source},${scores[c.catalogId] ?? ''},${c.order}`)
    const blob = new Blob(['catalogId,source,score,order\n' + rows.join('\n') + '\n'], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'ab-eval.csv' })
    a.click()
    URL.revokeObjectURL(a.href)
    setRevealed(true)
  }

  return (
    <div>
      <p className="detail">카드마다 "나와 관련 있다"를 1~5로 매겨 주세요. 어느 쪽 추천인지는 평가 후에 보입니다.</p>
      {cards.map((c) => (
        <div className="rx" key={c.catalogId}>
          <div className="meta"><b>{c.name}</b>{revealed && <span>{c.source}</span>}</div>
          <p>{c.what}</p>
          <p className="detail">{c.how}</p>
          <p>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={scores[c.catalogId] === n ? 'on' : ''} onClick={() => setScores((s) => ({ ...s, [c.catalogId]: n }))}>{n}</button>
            ))}
          </p>
        </div>
      ))}
      <button disabled={!done} onClick={exportCsv}>평가 저장(CSV)</button>
      {!done && <span className="detail"> 모든 카드에 점수를 매기면 저장할 수 있습니다.</span>}
    </div>
  )
}
