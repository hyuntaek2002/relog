import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 개발 중 /@fs/ 로 저장소 상위(exports/)의 실제 내보내기 파일을 불러 테스트하기 위함. 빌드에는 영향 없음.
  server: { fs: { allow: ['..'] } },
})
