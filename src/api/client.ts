import { comparisonParams, sourceParams } from '../features/settings/sourceSettings.ts'
import type {
  ApiError,
  ComparisonResponse,
  DiffOptions,
  FileContentResponse,
  SchemaChangesResponse,
  SchemaComparisonResponse,
  SchemaSnapshotListResponse,
  SnapshotChangesResponse,
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
  if (options.ignoreAuthor) out.ignoreAuthor = '1'
  if (options.ignoreDeadCode) out.ignoreDeadCode = '1'
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

/**
 * 날짜마다 바로 앞 날짜 대비 변경 수 — 날짜 고르기 목록의 "변경 N개" · "바뀐 날짜만".
 * 날짜 목록과 따로 묻는다: 로컬은 본문을 읽어야 해서 느릴 수 있는데, 그 때문에 목록이 늦게 뜨면 안 된다.
 */
export function fetchSnapshotChanges(source: SourceConfig): Promise<SnapshotChangesResponse> {
  return getJson<SnapshotChangesResponse>('/snapshots/changes', sourceParams(source))
}

/**
 * 좌우 스냅샷 비교 — 패키지 요약 + 파일 목록 (본문 없음).
 * 좌우는 **서로 다른 위치**일 수 있다 (운영 ↔ 테스트).
 */
export function fetchComparison(
  leftSource: SourceConfig,
  rightSource: SourceConfig,
  left: string,
  right: string,
  options: DiffOptions
): Promise<ComparisonResponse> {
  return getJson<ComparisonResponse>('/comparisons', {
    ...comparisonParams(leftSource, rightSource),
    left,
    right,
    ...optionParams(options),
  })
}

/**
 * 좌우 환경의 스키마 날짜 목록.
 *
 * 코드와 달리 **환경을 따로 보낸다.** 코드는 고른 환경 폴더가 이미 `source.root` 에
 * 붙어 있지만, 스키마는 `schemaRoot` 아래에 환경 폴더가 따로 붙어서
 * 서버가 그 이름을 알아야 경로를 만들 수 있다.
 */
export function fetchSchemaSnapshots(
  source: SourceConfig,
  leftEnv: string,
  rightEnv: string
): Promise<SchemaSnapshotListResponse> {
  return getJson<SchemaSnapshotListResponse>('/schemas/snapshots', {
    ...sourceParams(source),
    leftEnv,
    rightEnv,
  })
}

/**
 * 좌우 환경의 덤프 날짜마다 바로 앞 덤프 대비 **테이블** 변경 수 — 스키마 탭 날짜 목록의 "테이블 N개 바뀜".
 * 날짜 목록과 따로 묻는다(덤프를 하나씩 읽어야 해서 느릴 수 있다).
 */
export function fetchSchemaChanges(
  source: SourceConfig,
  leftEnv: string,
  rightEnv: string
): Promise<SchemaChangesResponse> {
  return getJson<SchemaChangesResponse>('/schemas/changes', {
    ...sourceParams(source),
    leftEnv,
    rightEnv,
  })
}

/** 좌우 스키마 대조 — 테이블별 컬럼·제약·인덱스 차이 */
export function fetchSchemaComparison(
  source: SourceConfig,
  leftEnv: string,
  rightEnv: string,
  left: string,
  right: string
): Promise<SchemaComparisonResponse> {
  return getJson<SchemaComparisonResponse>('/schemas', {
    ...sourceParams(source),
    leftEnv,
    rightEnv,
    left,
    right,
  })
}

/** 선택한 파일 한 건의 좌우 본문 */
export function fetchFileContent(
  leftSource: SourceConfig,
  rightSource: SourceConfig,
  left: string,
  right: string,
  path: string
): Promise<FileContentResponse> {
  return getJson<FileContentResponse>('/comparisons/files', {
    ...comparisonParams(leftSource, rightSource),
    left,
    right,
    path,
  })
}
