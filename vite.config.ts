import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import codeRepository from './server/codeRepositoryPlugin.ts'
import { SCAN } from './change/config.ts'

// 설정은 전부 `change/config.ts` 에 있다 (.env 는 쓰지 않는다).
export default defineConfig({
  plugins: [react(), codeRepository(SCAN)],
  server: {
    port: 5181,
    open: false,
    // 이 API 는 로컬 폴더·원격 서버를 읽는다.
    // 다른 사이트가 브라우저를 통해 찔러보지 못하도록 교차 출처를 막는다.
    cors: false,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
  },
})
