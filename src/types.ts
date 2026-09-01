/**
 * 프로젝트 전역 도메인 타입.
 * 서버(server/*) 와 화면(src/*) 이 함께 import 하는 유일한 계약 지점이다.
 */

/* ================================================================
   비교 대상 위치 (로컬 폴더 / SSH 원격)
   ================================================================ */

export type SourceMode = 'local' | 'ssh'

/**
 * 소스 파일을 읽을 때 쓰는 문자 인코딩.
 * `auto` 는 UTF-8 로 읽어보고 유효하지 않으면 EUC-KR 로 본다 (UNIX 의 오래된 Pro*C 소스 대응).
 */
export type TextEncodingName = 'auto' | 'utf-8' | 'euc-kr'

export const TEXT_ENCODINGS: readonly { value: TextEncodingName; label: string }[] = [
  { value: 'auto', label: '자동' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'euc-kr', label: 'EUC-KR' },
]

/** 로컬·SSH 가 함께 갖는 설정 */
interface SourceBase {
  /** 날짜 폴더들의 부모 경로 */
  root: string
  encoding: TextEncodingName
}

export interface LocalSourceConfig extends SourceBase {
  mode: 'local'
  /** 상대 경로는 프로젝트 폴더 기준으로 푼다 */
  root: string
}

/**
 * SSH 원격 설정.
 *
 * **인증은 ssh 에 맡긴다.** 비밀번호는 받지도 보관하지도 않는다 —
 * 개인키 · ssh-agent · `~/.ssh/config` 로 붙고, 그것으로 안 되면 ssh 가
 * **개발 서버 터미널에** 직접 물어본다.
 */
export interface SshSourceConfig extends SourceBase {
  mode: 'ssh'
  host: string
  /** 비우면 ssh 기본값(22) */
  port: number | null
  user: string
  /** 개인키 파일 경로. 비우면 ssh 기본 키를 쓴다 */
  identityFile: string
  /** 원격 서버의 날짜 폴더 부모 경로 */
  root: string
}

export type SourceConfig = LocalSourceConfig | SshSourceConfig

export const DEFAULT_LOCAL_SOURCE: LocalSourceConfig = {
  mode: 'local',
  root: '',
  encoding: 'auto',
}

export const DEFAULT_SSH_SOURCE: SshSourceConfig = {
  mode: 'ssh',
  host: '',
  port: null,
  user: '',
  identityFile: '',
  root: '',
  encoding: 'auto',
}

/**
 * `change/config.ts` 에 두는 위치 프리셋.
 * 화면에서 골라 쓰고, 값을 직접 고치면 "직접 입력"으로 바뀐다.
 */
export interface SourcePreset {
  /** 저장에 쓰는 식별자. 바꾸면 저장된 선택이 풀린다 */
  id: string
  label: string
  description?: string
  source: SourceConfig
}

/**
 * `change/config.ts` 에 두는 **환경 폴더** — 운영 / 테스트 / 개발.
 *
 * 환경이 루트 아래 폴더로 나뉘어 있을 때 (`release/prod/20260801` · `release/test/20260801`)
 * 어느 환경을 볼지 화면에서 고른다. 고른 환경의 `path` 가 루트 뒤에 붙어
 * **그 폴더가 곧 새 루트**가 된다 — 날짜 목록도 비교도 전부 그 아래에서 일어난다.
 *
 * 하나라도 적혀 있으면 **항상 그중 하나가 골라져 있다.** 루트를 그대로 읽고 싶으면
 * (날짜 폴더가 루트에 바로 있는 배치) 배열을 비우면 된다 — 고르는 자리도 함께 사라진다.
 *
 * 서버·계정까지 다르면 이게 아니라 환경별 `SourcePreset` 을 하나씩 두면 된다.
 */
export interface EnvFolder {
  /** 저장에 쓰는 식별자. 바꾸면 저장된 선택이 풀린다 */
  id: string
  label: string
  /** 루트 뒤에 붙일 하위 경로 (`prod`, `release/prod` 처럼 여러 단도 된다) */
  path: string
  description?: string
}

/** `change/config.ts` 의 훑기 설정 — 어떤 파일을 비교 대상으로 볼지 */
export interface ScanConfig {
  /** 비교 대상 확장자 (점 없이) */
  extensions: readonly string[]
  /** 한 파일 최대 크기(바이트) */
  maxFileBytes: number
}

/* ================================================================
   외부 폴더 — 스냅샷 / 패키지 / 파일
   ================================================================ */

/** 좌/우 어느 쪽인지 */
export type Side = 'left' | 'right'

/** 외부 폴더 안의 날짜 폴더 하나 */
export interface Snapshot {
  /** 폴더명 그대로 (예: `2026-08-01`) — 목록의 식별자 */
  id: string
  /** 정렬용 키. 폴더명에서 뽑은 8자리 숫자(YYYYMMDD), 못 뽑으면 빈 문자열 */
  sortKey: string
  fileCount: number
  packageCount: number
}

/** 파일 한 건이 좌우 비교에서 갖는 상태 */
export type FileStatus = 'added' | 'removed' | 'modified' | 'same'

/** 패키지(= 날짜 폴더 바로 아래 디렉터리) 한 건이 갖는 상태 */
export type PackageStatus = FileStatus

/** 좌우를 비교한 파일 한 건 (본문은 포함하지 않는다) */
export interface ComparedFile {
  /** 날짜 폴더 기준 상대 경로 (예: `ord/ord_create.pc`) — 목록의 식별자 */
  path: string
  /** 파일명만 */
  name: string
  /** 소속 패키지명 */
  packageName: string
  status: FileStatus
  /**
   * 항상 채워진다. 한쪽에만 있는 파일은 빈 파일과 비교한 값이라
   * 신규 파일은 전 줄이 added, 삭제 파일은 전 줄이 removed 로 잡힌다.
   * (전체 합계가 실제 변경량을 반영하도록 하기 위함)
   */
  stats: DiffStats
  leftSize: number | null
  rightSize: number | null
}

/** 패키지 단위 변경 요약 — 화면 상단 밴드에 쓴다 */
export interface PackageChange {
  name: string
  status: PackageStatus
  added: number
  removed: number
  modified: number
  same: number
  /** 변경된 파일들의 추가+삭제+수정 줄 합계 */
  changedLines: number
}

/** `GET /api/v1/snapshots` 응답 */
export interface SnapshotListResponse {
  /** 화면에 보여줄 외부 폴더 경로 */
  root: string
  items: Snapshot[]
}

/** `GET /api/v1/comparisons` 응답 */
export interface ComparisonResponse {
  left: string
  right: string
  packages: PackageChange[]
  files: ComparedFile[]
  /** 비교 대상에서 빠진 파일 수 (용량 초과·미지원 확장자) */
  skipped: number
}

/** `GET /api/v1/comparisons/files` 응답 — 선택한 파일의 본문 */
export interface FileContentResponse {
  path: string
  leftText: string | null
  rightText: string | null
}

/** 서버가 오류를 돌려줄 때의 공통 형태 */
export interface ApiError {
  code: string
  message: string
}

/* ================================================================
   비교 옵션
   ================================================================ */

export interface DiffOptions {
  /** 들여쓰기·공백량 차이 무시 */
  ignoreWhitespace: boolean
  /** 대소문자 무시 */
  ignoreCase: boolean
  /** 빈 줄을 비교 대상에서 제외 */
  ignoreBlankLines: boolean
  /** 주석 전용 줄을 비교 대상에서 제외 */
  ignoreComments: boolean
  /**
   * 작성자 표기 줄(`작성자 : 홍길동`, `@author gdhong`)을 비교 대상에서 제외.
   *
   * 소스를 손댄 사람이 머리말에 이름을 남기는 관행 때문에, 로직이 같아도 이 한 줄
   * 때문에 파일이 "바뀐 파일" 로 올라온다. 주석 무시와 따로 두는 이유는 주석을
   * 남겨 두고 보고 싶은 경우가 있기 때문이다 — 그때도 이름 줄은 대개 군더더기다.
   */
  ignoreAuthor: boolean
  /**
   * 죽여 둔 코드 블록을 비교 대상에서 제외.
   *
   * 주석이 아니라 **조건부 컴파일**이지만, 조건이 거짓으로 못박힌 블록은 실행될 일이
   * 없어 주석과 같다. C 에서 `/* ... *` + `/` 는 중첩이 안 되므로, 여러 줄을 한꺼번에
   * 죽일 때 `#if 0` 을 쓰는 것이 오래된 관행이다.
   *
   * 빌드 옵션에 따라 살아나는 것(`#ifdef DEBUG`)은 건드리지 않는다 — 그건 죽은 코드가
   * 아니라 "이 빌드에서만 안 도는" 코드다.
   */
  ignoreDeadCode: boolean
}

/* ================================================================
   diff 결과
   ================================================================ */

/** `ignored` 는 무시 옵션으로 비교에서 빠졌지만 화면에는 남기는 줄이다 */
export type RowKind = 'equal' | 'modify' | 'add' | 'remove' | 'ignored'

/** 한 줄 안에서 바뀐 문자 구간 [start, end) */
export type CharRange = [number, number]

/** a = 왼쪽(이전 날짜), b = 오른쪽(이후 날짜) */
export interface DiffRow {
  id: number
  kind: RowKind
  /** 왼쪽 원본 줄 번호 (1-based) */
  aNo: number | null
  /** 오른쪽 원본 줄 번호 (1-based) */
  bNo: number | null
  aText: string | null
  bText: string | null
  aRanges: CharRange[] | null
  bRanges: CharRange[] | null
  /** modify 행에서 양쪽이 공유하는 문자 수 (문자 유사도 계산용) */
  commonA?: number
  commonB?: number
}

/** 연속된 변경 줄 묶음 = diff 포인트 하나 */
export interface Hunk {
  index: number
  rowStart: number
  rowEnd: number
  aStart: number | null
  bStart: number | null
  add: number
  del: number
  mod: number
  preview: string
}

export interface DiffStats {
  aLines: number
  bLines: number
  /** 무시 옵션 적용 후 실제 비교한 줄 수 */
  comparedA: number
  comparedB: number
  same: number
  modified: number
  added: number
  removed: number
  ignored: number
  changedLines: number
  charsA: number
  charsB: number
  commonChars: number
  /** 일치줄 / max(A, B) — "줄 갯수 대비" 유사도 */
  lineSimilarity: number
  /** 2 × 일치줄 / (A + B) */
  diceSimilarity: number
  /** 수정된 줄 안의 부분 일치까지 반영한 문자 단위 유사도 */
  charSimilarity: number
  /** 1 − lineSimilarity */
  changeRatio: number
}

export interface FileDiff {
  tooLarge: boolean
  rows: DiffRow[]
  hunks: Hunk[]
  stats: DiffStats
}

/** 화면에 그릴 구간 — 실제 행 묶음이거나, 접힌 구간 */
export interface RenderBlock {
  kind: 'rows' | 'gap'
  from: number
  to: number
}

/* ================================================================
   코드 내용 검색
   ================================================================ */

export interface SearchOptions {
  query: string
  /** 대소문자 구분 */
  caseSensitive: boolean
  /** 정규식으로 해석 */
  regex: boolean
}

/** 검색 결과 한 건 */
export interface CodeMatch {
  /** rows 배열 인덱스 */
  row: number
  side: 'a' | 'b'
  start: number
  end: number
}

export interface RowMatches {
  a: CharRange[]
  b: CharRange[]
}

export interface SearchResult {
  /** 위에서 아래로, 같은 행이면 왼쪽 → 오른쪽 순 */
  matches: CodeMatch[]
  /** 행 인덱스별 하이라이트 구간 */
  byRow: Map<number, RowMatches>
  /** 정규식 오류 메시지 */
  error: string | null
  /** 상한에 걸려 일부만 찾은 경우 */
  truncated: boolean
}

/* ================================================================
   하이라이트
   ================================================================ */

export interface Segment {
  text: string
  type: string | null
}

export interface MergedSegment extends Segment {
  changed: boolean
  /** 검색어와 일치 */
  match: boolean
  /** 현재 선택된 검색 결과 */
  active: boolean
}

/** 파일 전체를 라인별 세그먼트로 쪼갠 것 */
export type LineSegments = Segment[][]

/* ================================================================
   화면 상태
   ================================================================ */

export type ViewMode = 'split' | 'unified'
export type Theme = 'dark' | 'light'

/**
 * 코드 표시 범위.
 * `changed` = 변경된 부분만 (기본값), `full` = 파일 전체
 */
export type CodeScope = 'changed' | 'full'
