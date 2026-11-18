import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Viewer from './viewer/Viewer.tsx'
import AuthGate from './auth/AuthGate.tsx'
import { installFetchAudit } from './worker/netaudit.ts'

// 페이지의 fetch도 감사한다(개발 패널 "네트워크 감사"에서 확인).
installFetchAudit('page')

// ?view=1 이면 분석 화면 대신 최소 뷰어(서버 보관 통계·처방 열람)
const VIEW = new URLSearchParams(location.search).has('view')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 로그인해야 쓸 수 있다(2026-11-18). 분석은 그대로 브라우저 안에서만 한다 */}
    <AuthGate>{VIEW ? <Viewer /> : <App />}</AuthGate>
  </StrictMode>,
)
