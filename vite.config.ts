import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import codeRepository from './server/codeRepositoryPlugin.ts'
import { SCAN } from './change/config.ts'
import * as userConfig from './change/config.ts'
import type { SchemaConfig } from './src/types.ts'

/**
 * 스키마 설정은 나중에 생겼다 — 예전에 만들어 둔 `change/config.ts` 에는 없을 수 있다.
 * 없으면 기본 규칙으로 읽는다 (설정 하나 때문에 개발 서버가 안 뜨면 안 된다).
 */
const SCHEMA = (userConfig as { SCHEMA?: Partial<SchemaConfig> }).SCHEMA

// 설정은 전부 `change/config.ts` 에 있다 (.env 는 쓰지 않는다).
export default defineConfig({
  // 자산을 상대 경로로 참조한다(`./assets/…`). 절대 경로(`/assets/…`)로 두면
  // 도메인 루트가 아닌 하위 경로에 배포했을 때 브라우저가 엉뚱한 곳을 찾고,
  // 정적 서버가 대신 index.html(text/html)을 돌려줘 "MIME type is not supported" 로 죽는다.
  base: './',
  plugins: [react(), codeRepository(SCAN, SCHEMA)],
  server: {
    port: 5181,
    open: false,
    // 이 API 는 로컬 폴더·원격 서버를 읽는다.
    // 다른 사이트가 브라우저를 통해 찔러보지 못하도록 교차 출처를 막는다.
    cors: false,
  },
  build: {
    // 배포 스크립트(update.sh)가 dist_next → dist 로 스왑하므로 바로 그 이름으로 낸다.
    // 운영 중인 dist 를 건드리지 않고 새 빌드를 올려둘 수 있다 (롤백은 rollback.sh).
    outDir: 'dist_next',
    chunkSizeWarningLimit: 1200,
  },
})
