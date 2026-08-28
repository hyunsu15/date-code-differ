import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiError } from '../src/types.ts'

/** 개발 서버 미들웨어에서 쓰는 최소한의 요청/응답 유틸 */

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  // 외부 폴더 내용은 매번 달라질 수 있으므로 캐시하지 않는다
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string
): void {
  const body: ApiError = { code, message }
  sendJson(res, status, body)
}

/**
 * 쿼리 파라미터를 꺼낸다.
 * connect 미들웨어의 `req.url` 은 마운트 경로가 잘린 나머지라
 * 기준 URL 을 붙여 파싱한다.
 */
export function parseUrl(req: IncomingMessage): { pathname: string; query: URLSearchParams } {
  const url = new URL(req.url ?? '/', 'http://localhost')
  return { pathname: url.pathname, query: url.searchParams }
}

/** `?flag=1`, `?flag=true`, `?flag=on` 을 모두 true 로 본다 */
export function queryFlag(query: URLSearchParams, key: string): boolean {
  const v = query.get(key)
  return v === '1' || v === 'true' || v === 'on'
}

/** 요청 본문(JSON)을 읽는다. 비밀번호가 들어오므로 크기를 작게 제한한다 */
const MAX_BODY_BYTES = 8 * 1024

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('요청이 너무 큽니다.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('JSON 을 읽지 못했습니다.'))
      }
    })
    req.on('error', reject)
  })
}

/** 필수 문자열 파라미터 — 없으면 null */
export function requiredParam(query: URLSearchParams, key: string): string | null {
  const v = query.get(key)
  return v && v.trim() !== '' ? v.trim() : null
}
