import { useState } from 'react'

// 설명 문장은 본문에서 빼고 ? 아이콘을 눌렀을 때만 보여 준다(마우스를 올리면 title로도 보임).
// summary·label 안에 들어갈 수 있으므로 클릭이 바깥으로 번지지 않게 막는다.
export default function Help({ text }: { text: string }) {
  const [on, setOn] = useState(false)
  return (
    <span className="help">
      <button type="button" className="help-btn" title={text} aria-label="설명" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOn((o) => !o) }}>?</button>
      {on && <span className="help-pop" role="note">{text}</span>}
    </span>
  )
}
