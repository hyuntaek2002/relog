import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 개발 중 /@fs/ 로 저장소 상위(exports/)의 실제 내보내기 파일을 불러 테스트하기 위함. 빌드에는 영향 없음.
    fs: { allow: ['..'] },
    // performance.measureUserAgentSpecificMemory()(워커 포함 메모리 실측)는 cross-origin isolation이 필요하다.
    // credentialless는 모델 CDN 같은 외부 리소스를 막지 않는다.
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' },
  },
})
