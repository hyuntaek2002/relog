import { useEffect, useMemo, useState } from 'react'
import { isInstalled } from './taskPluginRules'

// 플러그인 찾기: 추천과 별개로 사용자가 카테고리·검색어로 직접 고른다. 데이터는 날짜가 박힌 정적 파일(public/)을 펼칠 때만 내려받는다.
// 설치는 여기서 하지 않고 Claude 앱 탐색 탭(카테고리 바로 가기)에서 사용자가 직접 한다.
import { filterPlugins, fmtInstalls, PLUGIN_FILE, PLUGIN_FORMAT, type PluginFile } from './pluginSearchRules'
const PAGE = 40

export default function PluginSearch({ installed = [] }: { installed?: string[] }) {
  const [data, setData] = useState<PluginFile | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => {
    if (!open || data) return
    fetch(import.meta.env.BASE_URL + PLUGIN_FILE).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((j: PluginFile) => (j.format === PLUGIN_FORMAT ? setData(j) : setErr('플러그인 목록 파일 형식이 다릅니다.'))).catch((e) => setErr(`플러그인 목록을 불러오지 못했습니다: ${(e as Error).message}`))
  }, [open, data])
  const cats = useMemo(() => (data ? Object.entries(data.categories).sort((a, b) => a[1].localeCompare(b[1], 'ko')) : []), [data])
  const rows = useMemo(() => (data ? filterPlugins(data.plugins, q, cat) : []), [data, q, cat])
  return (
    <details className="plugin-search" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>플러그인 찾기</summary>
      {err && <p className="err">{err}</p>}
      {open && !data && !err && <p className="detail">목록을 불러오는 중입니다.</p>}
      {data && (
        <>
          <p className="ps-controls">
            <input type="search" placeholder="이름이나 설명으로 검색" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} />
            <select value={cat} onChange={(e) => { setCat(e.target.value); setLimit(PAGE) }}>
              <option value="">모든 카테고리</option>
              {cats.map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}
            </select>
          </p>
          <p className="detail">{rows.length.toLocaleString()}개 · 설치 수 많은 순 · {data.fetchedAt} 기준. 카테고리는 탐색 탭 상위 100개까지만 있습니다.</p>
          <ul className="ps-list">
            {rows.slice(0, limit).map((p) => (
              <li key={p.n}>
                <p className="ps-head">
                  <b>{p.n}</b>
                  {isInstalled(p.n, installed) && <span className="tag have">이미 설치됨</span>}
                  {p.a && <span className="tag">Anthropic</span>}
                  {p.i != null && <span className="detail">설치 {fmtInstalls(p.i)}</span>}
                  {p.c.slice(0, 3).map((s) => <span key={s} className="tag">{data.categories[s] ?? s}</span>)}
                </p>
                <p className="ps-line">{p.k ?? p.s}</p>
                <p className="ps-links">
                  {p.c[0] && <a href={`https://claude.ai/new#customize/plugins/${p.c[0]}`} target="_blank" rel="noreferrer">탐색 탭에서 열기</a>}
                  {p.r && <a href={p.r} target="_blank" rel="noreferrer">저장소</a>}
                </p>
              </li>
            ))}
          </ul>
          {rows.length > limit && <button onClick={() => setLimit((l) => l + PAGE)}>더 보기 ({rows.length - limit}개 남음)</button>}
        </>
      )}
    </details>
  )
}
