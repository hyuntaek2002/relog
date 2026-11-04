import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 개발 중 /@fs/ 로 저장소 상위(exports/)의 실제 내보내기 파일을 불러 테스트하기 위함. 빌드에는 영향 없음.
    fs: { allow: ['..'] },
    // 메모리 실측용. performance.measureUserAgentSpecificMemory()는 cross-origin isolation이 필요한데,
    // COEP를 켜면 내장 브라우저에선 워커 로드가 ERR_BLOCKED_BY_RESPONSE로 막힌다. 그래서 기본은 끄고
    // 일반 Chrome에서 잴 때만 `RELOG_MEASURE=1 npm run dev`로 켠다.
    headers: process.env.RELOG_MEASURE === '1' ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } : {},
  },
})
