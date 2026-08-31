import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { parseUrl, queryFlag, requiredParam, sendError, sendJson } from './http.ts'
import {
  clearCache,
  listSnapshots,
  readRepositoryConfig,
  type RepositoryConfig,
} from './snapshotRepository.ts'
import { clearComparisonCache, compareSnapshots, readFilePair } from './comparisonService.ts'
import { createSource, sourceKey } from './source/resolve.ts'
import { SourceError, type SnapshotSource } from './source/types.ts'
import type {
  DiffOptions,
  ScanConfig,
  SnapshotListResponse,
  SourceConfig,
  TextEncodingName,
} from '../src/types.ts'

/**
 * 개발/미리보기 서버에 붙는 읽기 전용 API.
 * 비교 대상 위치(로컬 폴더 / SSH 원격)는 **요청마다** 쿼리로 받는다 —
 * 설정을 브라우저(localStorage)가 들고 있으므로 서버는 상태를 두지 않는다.
 *
 *   GET /api/v1/snapshots[?refresh=1][&prefix=prod][&소스 파라미터]
 *   GET /api/v1/comparisons?left=&right=[&무시옵션][&소스 파라미터]
 *   GET /api/v1/comparisons/files?left=&right=&path=[&소스 파라미터]
 *
 * **GET 뿐이다.** 대상 폴더를 수정하는 동작도, 자격증명을 받는 동작도 없다 —
 * SSH 인증은 ssh 가 알아서 한다(개인키·ssh-agent·~/.ssh/config).
 */

export const API_BASE = '/api/v1'

function readDiffOptions(query: URLSearchParams): DiffOptions {
  return {
    ignoreWhitespace: queryFlag(query, 'ignoreWhitespace'),
    ignoreCase: queryFlag(query, 'ignoreCase'),
    ignoreBlankLines: queryFlag(query, 'ignoreBlankLines'),
    ignoreComments: queryFlag(query, 'ignoreComments'),
  }
}

/**
 * 쿼리에서 소스 설정을 읽는다. `mode` 가 없으면 로컬로 본다.
 * 실제 값은 화면이 `change/config.ts` 의 프리셋에서 가져와 보낸다.
 */
export function readSourceConfig(query: URLSearchParams): SourceConfig {
  const encoding = readEncoding(query.get('encoding'))

  if (query.get('mode') !== 'ssh') {
    return { mode: 'local', root: query.get('root') ?? '', encoding }
  }
  const port = Number(query.get('port'))
  return {
    mode: 'ssh',
    host: query.get('host') ?? '',
    port: Number.isFinite(port) && port > 0 ? port : null,
    user: query.get('user') ?? '',
    identityFile: query.get('identityFile') ?? '',
    root: query.get('root') ?? '',
    encoding,
  }
}

/** 모르는 값은 자동 판별로 둔다 */
function readEncoding(raw: string | null): TextEncodingName {
  return raw === 'utf-8' || raw === 'euc-kr' ? raw : 'auto'
}

interface Resolved {
  source: SnapshotSource
  key: string
}

function createHandler(cfg: RepositoryConfig, projectRoot: string): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction): void => {
    const { pathname, query } = parseUrl(req)

    if (req.method !== 'GET') {
      next()
      return
    }

    /** 소스를 만들다 실패하면 그대로 응답하고 null 을 돌려준다 */
    const resolve = (): Resolved | null => {
      const config = readSourceConfig(query)
      try {
        return {
          source: createSource(config, projectRoot),
          key: sourceKey(config, projectRoot),
        }
      } catch (e) {
        const err = e as SourceError
        sendError(res, 400, err.code ?? 'SOURCE_INVALID', err.message)
        return null
      }
    }

    void (async () => {
      try {
        if (pathname === '/snapshots') {
          if (queryFlag(query, 'refresh')) {
            clearCache()
            clearComparisonCache()
          }
          const resolved = resolve()
          if (!resolved) return

          // 폴더 이름 접두사(prod/test/dev …). 없으면 거르지 않는다
          const body: SnapshotListResponse = {
            root: resolved.source.describe(),
            items: await listSnapshots(resolved.source, cfg, resolved.key, query.get('prefix') ?? ''),
          }
          sendJson(res, 200, body)
          return
        }

        if (pathname === '/comparisons/files') {
          const left = requiredParam(query, 'left')
          const right = requiredParam(query, 'right')
          const path = requiredParam(query, 'path')
          if (!left || !right || !path) {
            sendError(res, 400, 'MISSING_PARAM', 'left, right, path 파라미터가 모두 필요합니다.')
            return
          }
          const resolved = resolve()
          if (!resolved) return

          const pair = await readFilePair(resolved.source, left, right, path)
          if (pair.leftText === null && pair.rightText === null) {
            sendError(res, 404, 'FILE_NOT_FOUND', `양쪽 스냅샷 모두에 없는 파일입니다: ${path}`)
            return
          }
          sendJson(res, 200, pair)
          return
        }

        if (pathname === '/comparisons') {
          const left = requiredParam(query, 'left')
          const right = requiredParam(query, 'right')
          if (!left || !right) {
            sendError(res, 400, 'MISSING_PARAM', 'left, right 파라미터가 모두 필요합니다.')
            return
          }
          const resolved = resolve()
          if (!resolved) return

          sendJson(
            res,
            200,
            await compareSnapshots(
              resolved.source,
              cfg,
              resolved.key,
              left,
              right,
              readDiffOptions(query)
            )
          )
          return
        }

        next()
      } catch (e) {
        if (e instanceof SourceError) {
          // 루트를 못 찾은 것은 설정 문제라 404 로 갈라 안내한다 (그 밖은 접속·읽기 실패)
          const notFound = e.code === 'ROOT_NOT_FOUND'
          sendError(
            res,
            notFound ? 404 : 502,
            e.code,
            notFound
              ? `${e.message}\n\nchange/config.ts 의 프리셋 또는 화면의 ⚙ 위치 설정을 확인하세요.`
              : e.message
          )
          return
        }
        sendError(res, 500, 'INTERNAL', (e as Error).message)
      }
    })()
  }
}

/**
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
