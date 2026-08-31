import { sourceParams } from '../features/settings/sourceSettings.ts'
import type {
  ApiError,
  ComparisonResponse,
  DiffOptions,
  FileContentResponse,
  SnapshotListResponse,
  SourceConfig,
} from '../types.ts'

/**
 * 개발 서버의 읽기 전용 API 클라이언트.
 * 비교 대상 위치(로컬/SSH)는 서버가 들고 있지 않으므로 **요청마다 함께 보낸다.**
 */

const API_BASE = '/api/v1'

/** 서버가 돌려준 오류를 그대로 담아 화면에 보여줄 수 있게 한다 */
export class ApiRequestError extends Error {
  readonly code: string
  readonly status: number

  constructor(status: number, body: ApiError) {
    super(body.message)
    this.name = 'ApiRequestError'
    this.code = body.code
    this.status = status
  }
}

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null
    throw new ApiRequestError(res.status, body ?? { code: 'UNKNOWN', message: res.statusText })
  }
  return (await res.json()) as T
}

/** 무시 옵션을 쿼리 파라미터로 편다 — 켜진 것만 보낸다 */
function optionParams(options: DiffOptions): Record<string, string> {
  const out: Record<string, string> = {}
  if (options.ignoreWhitespace) out.ignoreWhitespace = '1'
  if (options.ignoreCase) out.ignoreCase = '1'
  if (options.ignoreBlankLines) out.ignoreBlankLines = '1'
  if (options.ignoreComments) out.ignoreComments = '1'
  return out
}

/**
 * 대상 폴더의 날짜 스냅샷 목록.
 *
 * 환경(운영/테스트/개발)은 따로 보내지 않는다 — 고른 환경 폴더가 이미 `source.root` 에
 * 붙어 있어서, 서버가 보는 루트 자체가 그 환경이다 (`features/settings/envFolder.ts`).
 */
export function fetchSnapshots(
  source: SourceConfig,
  refresh = false
): Promise<SnapshotListResponse> {
  return getJson<SnapshotListResponse>('/snapshots', {
    ...sourceParams(source),
    ...(refresh ? { refresh: '1' } : {}),
  })
}

/** 좌우 스냅샷 비교 — 패키지 요약 + 파일 목록 (본문 없음) */
export function fetchComparison(
  source: SourceConfig,
  left: string,
  right: string,
  options: DiffOptions
): Promise<ComparisonResponse> {
  return getJson<ComparisonResponse>('/comparisons', {
    ...sourceParams(source),
    left,
    right,
    ...optionParams(options),
  })
}

/** 선택한 파일 한 건의 좌우 본문 */
export function fetchFileContent(
  source: SourceConfig,
  left: string,
  right: string,
  path: string
): Promise<FileContentResponse> {
  return getJson<FileContentResponse>('/comparisons/files', {
    ...sourceParams(source),
    left,
    right,
    path,
  })
}
