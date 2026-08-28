import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { parseUrl, queryFlag, readJsonBody, requiredParam, sendError, sendJson } from './http.ts'
import {
  clearCache,
  listSnapshots,
  readRepositoryConfig,
  type RepositoryConfig,
} from './snapshotRepository.ts'
import { clearComparisonCache, compareSnapshots, readFilePair } from './comparisonService.ts'
import { createSource, sourceKey } from './source/resolve.ts'
import { forgetAllPasswords, setPassword } from './source/passwordStore.ts'
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
 * 대상 폴더를 수정하는 동작은 없다. 유일한 POST 는 아래 하나뿐이고,
 * 이것도 원격을 건드리지 않고 **이 프로세스 메모리에** 비밀번호를 담아둘 뿐이다.
 *
 *   POST /api/v1/ssh-credentials   { target, password }
 *
 * 이 엔드포인트는 터미널의 `npm run ssh-login` 만 호출한다 —
 * 브라우저는 비밀번호를 다루지 않는다.
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
    auth: query.get('auth') === 'password' ? 'password' : 'key',
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

    // 터미널에서 받은 비밀번호를 이 프로세스 메모리에 담는다 (유일한 POST)
    if (req.method === 'POST' && pathname === '/ssh-credentials') {
      void receiveCredentials(req, res)
      return
    }
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
            // 새로고침은 "처음부터 다시" 라는 뜻이므로 비밀번호도 비운다
            if (queryFlag(query, 'forgetPassword')) forgetAllPasswords()
          }
          const resolved = resolve()
          if (!resolved) return

          if (!(await resolved.source.exists())) {
            sendError(
              res,
              404,
              'ROOT_NOT_FOUND',
              `비교할 폴더를 찾을 수 없습니다: ${resolved.source.describe()}\n` +
                'change/config.ts 의 프리셋 또는 화면의 ⚙ 위치 설정을 확인하세요.'
            )
            return
          }

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
          sendError(res, 502, e.code, e.message)
          return
        }
        sendError(res, 500, 'INTERNAL', (e as Error).message)
      }
    })()
  }
}

/**
 * `npm run ssh-login` 이 보낸 비밀번호를 받는다.
 *
 * 메모리에만 담고 어디에도 기록하지 않는다. 로그에도 값을 남기지 않는다.
 * 로컬 개발 서버 전용이므로 접속 대상(`target`) 형식만 확인한다.
 */
async function receiveCredentials(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req)
    const value = (body ?? {}) as Record<string, unknown>

    const target = typeof value.target === 'string' ? value.target.trim() : ''
    const password = typeof value.password === 'string' ? value.password : ''

    if (!/^[^@\s]+@[^:\s]+:\d+$/.test(target)) {
      sendError(res, 400, 'BAD_TARGET', 'target 은 user@host:port 형식이어야 합니다.')
      return
    }
    if (!password) {
      sendError(res, 400, 'EMPTY_PASSWORD', '비밀번호가 비어 있습니다.')
      return
    }

    setPassword(target, password)
    sendJson(res, 200, { ok: true, target })
  } catch (e) {
    sendError(res, 400, 'BAD_REQUEST', (e as Error).message)
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
