import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installFetchAudit } from './worker/netaudit.ts'

// 페이지의 fetch도 감사한다(개발 패널 "네트워크 감사"에서 확인).
installFetchAudit('page')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
