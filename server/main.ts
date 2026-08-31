import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { API_BASE, createHandler } from './api.ts'
import { sendError } from './http.ts'
import { readRepositoryConfig } from './snapshotRepository.ts'
import { SCAN } from '../change/config.ts'

/**
 * 독립 실행 서버 — **한 포트에서 화면(정적 파일)과 API 를 함께** 준다.
 *
 * Vite 없이 배포할 때 쓴다. 화면과 API 가 같은 출처라 클라이언트가 쓰는
 * `/api/v1` 절대 경로가 그대로 맞고, CORS 도 프록시 설정도 필요 없다.
 *
 * ⚠ **이 API 에는 인증이 없다.** 대상 폴더를 읽고 ssh 를 실행하므로
 * 사내망 안이나 리버스 프록시 뒤에 둔다. 같은 장비에 nginx 를 세운다면
 * `HOST=127.0.0.1` 로 바깥 노출을 막고 nginx 만 앞에 내보낸다.
 *
 * 환경 변수
 *   PORT        듣는 포트            (기본 8080)
 *   HOST        듣는 주소            (기본 0.0.0.0 — 모든 인터페이스)
 *   STATIC_DIR  화면 파일 위치       (기본: 이 파일 기준 `../dist`)
 *
 * 기본값 `../dist` 는 두 배치에서 모두 맞는다 —
 * 저장소에서 바로 실행(`server/main.ts` → `dist/`)하든,
 * 번들을 배포(`backend/main.mjs` → `dist/`)하든 같은 자리다.
 */

const PORT = Number(process.env.PORT) || 8080
const HOST = process.env.HOST || '0.0.0.0'
const STATIC_DIR = path.resolve(
  process.env.STATIC_DIR || path.join(import.meta.dirname, '..', 'dist')
)

/**
 * 로컬 상대 경로(`./sample-code`)를 푸는 기준.
 * 실행한 위치가 기준이므로 pm2 에서는 `cwd` 를 배포 폴더로 고정한다.
 */
const PROJECT_ROOT = process.cwd()

/** 확장자 → Content-Type. 빌드 산출물에 실제로 나오는 것만 둔다 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

const api = createHandler(readRepositoryConfig(SCAN), PROJECT_ROOT)

/** `/api/v1` 로 시작하는가 — `/api/v1abc` 같은 남의 경로는 걸리지 않게 경계를 본다 */
function isApiRequest(url: string): boolean {
  return (
    url === API_BASE || url.startsWith(`${API_BASE}/`) || url.startsWith(`${API_BASE}?`)
  )
}

/**
 * 요청 경로를 정적 파일 경로로 바꾼다. 벗어나는 경로는 null.
 *
 * `..` 은 normalize 가 접어 주지만, 그것만 믿지 않고 결과가 STATIC_DIR 안에
 * 있는지 한 번 더 확인한다 — `%5C`(역슬래시)처럼 OS 마다 다르게 해석되는 입력이 있다.
 */
function resolveStaticPath(pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null // 깨진 퍼센트 인코딩
  }
  if (decoded.includes('\0')) return null

  let rel = path.normalize(decoded)
  while (rel.startsWith(path.sep) || rel.startsWith(path.posix.sep)) rel = rel.slice(1)
  const target = path.resolve(STATIC_DIR, rel)
  const inside = target === STATIC_DIR || target.startsWith(STATIC_DIR + path.sep)
  return inside ? target : null
}

/**
 * 화면 파일을 준다.
 *
 * 없는 경로는 두 갈래다. **확장자가 있으면** 진짜 없는 자산이라 404 를 준다.
 * 확장자가 없으면 화면 경로로 보고 `index.html` 을 준다 — 이때도 200 HTML 이지만,
 * API 는 위에서 이미 갈라져 여기까지 오지 않으므로 JSON 자리에 HTML 이 섞이지 않는다.
 */
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET, HEAD')
    res.end()
    return
  }

  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  const resolved = resolveStaticPath(pathname)
  if (!resolved) {
    res.statusCode = 400
    res.end()
    return
  }

  let file = resolved
  let stat = await fs.stat(file).catch(() => null)
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html')
    stat = await fs.stat(file).catch(() => null)
  }

  if (!stat?.isFile()) {
    if (path.extname(pathname) !== '') {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`없는 파일입니다: ${pathname}\n`)
      return
    }
    file = path.join(STATIC_DIR, 'index.html')
    stat = await fs.stat(file).catch(() => null)
    if (!stat?.isFile()) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`화면 파일이 없습니다: ${STATIC_DIR}\nnpm run build 후 dist 를 이 자리에 두세요.\n`)
      return
    }
  }

  const body = await fs.readFile(file)
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
  // assets/ 아래는 파일명에 내용 해시가 붙어 있어 내용이 바뀌면 이름이 바뀐다 — 오래 캐시해도 안전하다.
  // index.html 은 그 새 이름을 가리키는 지도라서 캐시하면 배포해도 옛 화면이 남는다.
  res.setHeader(
    'Cache-Control',
    file.startsWith(path.join(STATIC_DIR, 'assets') + path.sep)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
  )
  res.end(req.method === 'HEAD' ? undefined : body)
}

const server = createServer((req, res) => {
  const url = req.url ?? '/'

  if (isApiRequest(url)) {
    // connect 가 해 주던 마운트 접두사 제거를 여기서 한다 (핸들러는 나머지 경로만 본다).
    // 나머지가 비면 `/`, 쿼리로 시작하면 앞에 `/` 를 붙인다 — connect 와 같은 규칙이다.
    const rest = url.slice(API_BASE.length)
    req.url = rest.startsWith('/') ? rest : `/${rest}`

    // 미매칭 API 경로는 **JSON 404** 로 끝낸다. 화면 파일로 흘려보내면
    // `<!doctype html>` 이 200 으로 나가서 클라이언트가 JSON 파싱에서 죽는다.
    api(req, res, () =>
      sendError(res, 404, 'NOT_FOUND', `없는 API 경로입니다: ${req.method} ${url}`)
    )
    return
  }

  void serveStatic(req, res).catch((e: Error) => {
    res.statusCode = 500
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end(`${e.message}\n`)
  })
})

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST
  console.log(`code-diff  →  http://${shown}:${PORT}`)
  console.log(`  화면   ${STATIC_DIR}`)
  console.log(`  API    ${API_BASE}`)
  console.log(`  기준   ${PROJECT_ROOT}  (로컬 상대 경로를 푸는 자리)`)
})

// 화면 파일이 없어도 API 는 뜨므로 조용히 404 만 난다 — 시작할 때 미리 알려 준다
void fs.stat(STATIC_DIR).catch(() => {
  console.warn(`  ⚠ 화면 폴더가 없습니다: ${STATIC_DIR}`)
  console.warn(`    npm run build 후 dist 를 이 자리에 두거나 STATIC_DIR 로 지정하세요.`)
})
