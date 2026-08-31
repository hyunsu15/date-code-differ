import type { Plugin } from 'vite'
import { API_BASE, createHandler } from './api.ts'
import { readRepositoryConfig, type RepositoryConfig } from './snapshotRepository.ts'
import type { ScanConfig } from '../src/types.ts'

/**
 * 개발·미리보기 서버에 읽기 전용 API 를 붙이는 **Vite 어댑터**.
 *
 * 라우팅은 여기 없다 — `api.ts` 에 있고, 독립 실행 서버(`main.ts`)와 같은 핸들러를 쓴다.
 * 이 파일이 하는 일은 두 가지뿐이다: 설정을 읽어 두고, 미들웨어로 꽂는다.
 *
 * `server.middlewares.use(API_BASE, ...)` 로 마운트하면 connect 가 접두사를 잘라 주므로
 * 핸들러는 `/snapshots` 같은 나머지 경로만 본다.
 *
 * @param scan `change/config.ts` 의 훑기 설정
 */
export default function codeRepository(scan: Partial<ScanConfig>): Plugin {
  let cfg: RepositoryConfig
  let projectRoot = process.cwd()

  return {
    name: 'code-diff-repository',

    configResolved(config) {
      cfg = readRepositoryConfig(scan)
      projectRoot = config.root
    },

    configureServer(server) {
      server.middlewares.use(API_BASE, createHandler(cfg, projectRoot))
      server.config.logger.info(
        `  ⚙ 위치 프리셋·훑기 설정 → change/config.ts  (대상 확장자: ${[...cfg.extensions].join(', ')})`
      )
    },

    configurePreviewServer(server) {
      server.middlewares.use(API_BASE, createHandler(cfg, projectRoot))
    },
  }
}
