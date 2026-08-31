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

/** 필수 문자열 파라미터 — 없으면 null */
export function requiredParam(query: URLSearchParams, key: string): string | null {
  const v = query.get(key)
  return v && v.trim() !== '' ? v.trim() : null
}
