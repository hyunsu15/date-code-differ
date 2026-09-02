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
  /**
   * 비교에서 접어 둘 파일 목록이 적힌 텍스트 파일의 경로. 비우면 접지 않는다.
   *
   * **`root` 와 무관하게 푼다.** 환경 폴더(운영/테스트)는 `root` 뒤에 붙으므로 좌우가
   * 서로 다른 루트를 보는데, 제외 규칙까지 갈라지면 "운영에서는 접히고 테스트에서는
   * 안 접히는" 목록이 나온다. 한 비교에는 한 목록이다.
   *
   * 로컬은 상대 경로를 프로젝트 폴더 기준으로 풀고(`root` 와 같은 규칙), SSH 는 원격
   * 경로를 그대로 쓴다 (`~/release/exclude.txt` 처럼 홈 기준도 된다).
   *
   * 형식과 판정 규칙은 `src/lib/excludeList.ts` 가 갖고 있다.
   */
  excludeFile?: string
  /**
   * 데이터 스키마 덤프가 쌓이는 폴더. 비우면 화면에 스키마 비교가 뜨지 않는다.
   *
   * **`excludeFile` 과 같은 규칙으로 `root` 와 무관하게 푼다** — 스키마는 소스와
   * 다른 자리에 쌓이기 때문이다. 아래는 환경 폴더로 갈리고, 그 안에 날짜별 파일이
   * 하나씩 있다 (이름 규칙은 `change/config.ts` 의 `SCHEMA.fileName`).
   *
   *     <schemaRoot>/prod/snapshot_prod_2026-09-01.txt
   *
   * 접속 정보(호스트·계정·키·인코딩)는 이 프리셋의 것을 그대로 쓴다 — 스키마가
   * 대개 소스와 같은 서버에 있어, 경로 한 줄만 더 적으면 되게 한다.
   */
  schemaRoot?: string
  /**
   * 스키마 비교에서 접어 둘 대상이 적힌 텍스트 파일. 비우면 접지 않는다.
   *
   * `excludeFile` 과 같은 자리·같은 규칙으로 푼다 (`root` 와 무관). 문법도 같다 —
   * 다만 대상이 파일 경로가 아니라 **테이블과 그 안의 이름**이다.
   *
   *     TB_ORD_BAK         그 테이블과 그 아래 전부
   *     TB_ORD.ORD_MEMO    그 테이블의 그 컬럼만
   *     *.REG_DTM          모든 테이블의 그 컬럼 (감사 컬럼)
   *     IX_*_TMP           이름이 맞는 인덱스·제약
   *
   * 판정은 `src/features/schema/schemaExclude.ts` 가 `excludeList.ts` 에 맡긴다.
   */
  schemaExcludeFile?: string
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
  excludeFile: '',
  schemaRoot: '',
  schemaExcludeFile: '',
}

export const DEFAULT_SSH_SOURCE: SshSourceConfig = {
  mode: 'ssh',
  host: '',
  port: null,
  user: '',
  identityFile: '',
  root: '',
  encoding: 'auto',
  excludeFile: '',
  schemaRoot: '',
  schemaExcludeFile: '',
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
  /**
   * 제외 목록 파일에서 항목을 가르는 글자들. 비우면 쉼표와 줄바꿈 둘 다.
   * 목록 형식이 이미 정해져 있는 현장(예: 세미콜론 구분)을 위해 열어 둔다.
   */
  excludeSeparators?: readonly string[]
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
  /**
   * 제외 목록에 걸려 **접어 둔** 파일.
   *
   * 비교는 그대로 했다 — 거른 것이 아니라 목록에서 접었을 뿐이라, 화면이 펼치면
   * 변경량까지 그대로 보인다. 걸린 파일에 변경이 있으면 그 사실을 따로 알려야 한다.
   */
  excluded: boolean
  /** 걸린 규칙의 원문 (`*_bak.pc`). 접히지 않았으면 null */
  excludedBy: string | null
  /**
   * **내 제외 목록** 때문에 접힌 것 (서버의 규칙 파일이 아니라).
   *
   * 서버는 이 값을 채우지 않는다 — 화면이 응답을 받은 뒤 얹는다
   * (`features/settings/localExclude.ts`). 어느 목록을 고쳐야 펼쳐지는지
   * 알려면 둘을 갈라 둬야 한다.
   */
  excludedLocal?: boolean
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

/**
 * 제외 목록의 상태.
 *
 * 응답에 함께 실어 화면이 **"왜 이게 안 보이는지"** 를 말할 수 있게 한다.
 * 조용히 접기만 하면 제외해 둔 자리에 들어온 변경을 아무도 못 본다.
 */
export interface ExcludeInfo {
  /** 설정에 적힌 규칙 파일 경로. 비어 있으면 이 기능을 쓰지 않는 것 */
  file: string
  /** 읽어 들인 규칙 수 */
  rules: number
  /** 접어 둔 파일 수 */
  files: number
  /** 그중 **실제로 바뀐** 파일 수. 0 이 아니면 눈에 띄게 알린다 */
  changed: number
  /** 규칙 파일을 읽지 못했을 때의 안내. 조용히 넘어가지 않는다 */
  error: string | null
}

/** `GET /api/v1/comparisons` 응답 */
export interface ComparisonResponse {
  left: string
  right: string
  /** 접어 둔 파일을 **뺀** 요약 — 화면에 보이는 목록과 합계가 어긋나지 않게 한다 */
  packages: PackageChange[]
  /** 접어 둔 파일도 들어 있다 (`excluded` 로 표시). 펼치면 그대로 보인다 */
  files: ComparedFile[]
  /** 비교 대상에서 빠진 파일 수 (용량 초과·미지원 확장자) */
  skipped: number
  exclude: ExcludeInfo
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

/* ================================================================
   데이터 스키마 — 테이블 정의 스냅샷

   소스와 **다른 자리**에 쌓이는 Oracle 딕셔너리 덤프를 좌우로 견준다.
   파일 하나가 스냅샷 한 벌이고, 줄마다 앞머리 `[…]` 로 종류를 밝힌다.

     [COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N
     [CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1
     [INDEX],TB_ORD,IX_ORD_01,NONUNIQUE,ORD_DT,1

   형식과 판정 규칙은 `src/lib/schemaParse.ts`, 좌우 대조는 `src/lib/schemaDiff.ts`.
   ================================================================ */

/** 덤프 한 줄의 앞머리 `[…]` — 어떤 종류의 레코드인지 */
export type SchemaKind = 'column' | 'constraint' | 'index'

export const SCHEMA_KINDS: readonly SchemaKind[] = ['column', 'constraint', 'index']

export const SCHEMA_KIND_LABEL: Record<SchemaKind, string> = {
  column: '컬럼',
  constraint: '제약',
  index: '인덱스',
}

/**
 * 제약 종류 (`USER_CONSTRAINTS.CONSTRAINT_TYPE`).
 * 모르는 값은 `other` 로 모아 두고 원문을 배지에 그대로 보여준다.
 */
export type ConstraintKind = 'P' | 'R' | 'U' | 'C' | 'other'

/** 컬럼 하나 */
export interface SchemaColumn {
  name: string
  /**
   * 화면에 보여줄 타입 문자열 — `VARCHAR2(20)` · `NUMBER(15,2)` · `DATE`.
   *
   * `DATA_LENGTH` 를 그대로 두지 않는다. 그 값은 문자형에서만 뜻이 있고
   * NUMBER 는 늘 22, DATE 는 늘 7 이라 비교하면 없는 변경이 생긴다
   * (`schemaParse.formatType`).
   */
  type: string
  /** `NULLABLE` 이 `Y` 인가. `N` 이면 NOT NULL 이다 (Oracle 딕셔너리 규약) */
  nullable: boolean
}

/** 제약 하나 — 컬럼별로 흩어진 여러 줄을 `POSITION` 순으로 묶은 결과 */
export interface SchemaConstraint {
  name: string
  kind: ConstraintKind
  /** 딕셔너리에 적힌 원문 (`P` · `R` …). 모르는 값을 배지에 그대로 쓴다 */
  rawKind: string
  /** `POSITION` 순으로 정렬한 컬럼들 */
  columns: string[]
  /** 이름을 DB 가 붙인 것 (`SYS_C0011234`) — 데이터베이스마다 달라 비교에서 접는다 */
  systemNamed: boolean
}

/** 인덱스 하나 — 제약과 같은 방식으로 `COLUMN_POSITION` 순으로 묶는다 */
export interface SchemaIndex {
  name: string
  unique: boolean
  columns: string[]
  systemNamed: boolean
}

export interface TableSchema {
  name: string
  columns: SchemaColumn[]
  constraints: SchemaConstraint[]
  indexes: SchemaIndex[]
}

/** 스키마 파일 한 벌을 읽어 들인 결과 */
export interface SchemaSnapshot {
  /** 파일 맨 위 `#` 설명 줄들을 이어 붙인 것. 없으면 빈 문자열 */
  description: string
  tables: TableSchema[]
  /** 종류를 못 알아본 줄 수. 조용히 넘어가지 않고 화면에 남긴다 */
  malformed: number
  /**
   * 못 읽은 줄의 **원문 앞부분** 몇 개.
   *
   * 수만 알려 주면 구분자가 틀린 것인지 앞머리 태그가 다른 것인지 화면에서 가릴 수가
   * 없다 — 둘 다 "테이블 0개 · 못 읽은 줄 N" 으로 똑같이 보인다. 실물을 한 줄만 보여
   * 주면 원인이 바로 드러난다.
   */
  malformedSample: string[]
}

/* ---------------- 좌우 대조 결과 ---------------- */

export type SchemaItemStatus = FileStatus

/** 한 줄의 한쪽 값 */
export interface SchemaCell {
  /** 종류 배지 — `기본키` · `유니크`. 컬럼 섹션에서는 null */
  badge: string | null
  /** 표시값 — `VARCHAR2(20) NN` · `ORD_NO, ORD_SEQ` */
  value: string
}

/** 좌우를 이름으로 짝지은 한 줄 (컬럼·제약·인덱스가 같은 모양을 쓴다) */
export interface SchemaRow {
  name: string
  status: SchemaItemStatus
  /** 왼쪽에 없으면 null (신규) */
  left: SchemaCell | null
  /** 오른쪽에 없으면 null (삭제) */
  right: SchemaCell | null
  /** DB 가 이름을 붙인 것 — 기본으로 접는다 */
  systemNamed: boolean
  /**
   * 제외 목록에 걸려 **접어 둔** 줄.
   *
   * 서버는 채우지 않는다 — 화면이 응답을 받은 뒤 얹는다
   * (`features/schema/schemaExclude.ts`). 대조는 그대로 했고 목록에서만 접은 것이라,
   * 펼치면 값이 그대로 보인다.
   */
  excluded?: boolean
  /** 걸린 규칙의 원문 (`*.REG_DTM`) */
  excludedBy?: string | null
  /** 팀 공용 파일이 아니라 **내 목록** 때문에 접힌 것 */
  excludedLocal?: boolean
}

export interface SchemaSection {
  kind: SchemaKind
  /** 접지 않은 줄들 */
  rows: SchemaRow[]
  added: number
  removed: number
  modified: number
  /** 양쪽 통틀어 센 줄 수 (동일 포함, 접은 것 제외) */
  total: number
  /**
   * 시스템 이름이라 접어 둔 줄 수.
   * 조용히 지우지 않고 섹션 머리에 남긴다 — 접은 자리에 진짜 변경이 섞여도 알 수 있게.
   */
  systemHidden: number
  /**
   * 제외 목록에 걸려 접어 둔 줄 수. `systemHidden` 과 따로 센다 —
   * 접힌 이유가 다르면 고칠 자리도 다르다 (설정 정규식 vs 제외 목록).
   */
  excludedHidden: number
  /** 접힌 줄 중 **실제로 바뀐** 수. 0 이 아니면 눈에 띄게 알린다 */
  excludedChanged: number
}

/** 테이블 하나의 좌우 대조 */
export interface TableDiff {
  name: string
  status: SchemaItemStatus
  sections: Record<SchemaKind, SchemaSection>
  /**
   * 기본키가 바뀌었는지.
   * 빈도는 낮고 위험은 크다 — 목록에서 따로 눈에 띄게 알린다.
   */
  primaryKeyChanged: boolean
  /** 변경이 있는 종류들 — 상단 밴드의 종류 필터가 이 값을 본다 */
  changedKinds: SchemaKind[]
  /** 제외 목록에 걸려 접어 둔 테이블 (`SchemaRow.excluded` 와 같은 규칙) */
  excluded?: boolean
  excludedBy?: string | null
  excludedLocal?: boolean
}

/**
 * 팀이 함께 쓰는 스키마 제외 규칙.
 *
 * **규칙만 실어 보내고 적용은 화면이 한다.** 내 목록·종류 토글과 합쳐 한 자리에서
 * 세어야 요약 숫자가 갈리지 않는다 (`features/schema/schemaExclude.ts`).
 * 파일을 읽는 일만 서버 몫이다 — 로컬일 수도 원격일 수도 있어서다.
 */
export interface SchemaExcludeInfo {
  /** 설정에 적힌 규칙 파일 경로. 비어 있으면 이 기능을 쓰지 않는 것 */
  file: string
  /** 읽어 들인 규칙 원문들 */
  rules: string[]
  /** 규칙 파일을 읽지 못했을 때의 안내. 조용히 넘어가지 않는다 */
  error: string | null
}

/** `GET /api/v1/schemas` 응답 */
export interface SchemaComparisonResponse {
  /** 실제로 읽은 좌우 스키마 날짜 (고른 날짜와 다를 수 있다) */
  left: string
  right: string
  /** 파일 맨 위 `#` 설명 — 좌우가 다르면 그것도 변경이다 */
  leftDescription: string
  rightDescription: string
  tables: TableDiff[]
  /** 양쪽에서 읽지 못한 줄 수 합 */
  malformed: number
  /** 못 읽은 줄의 원문 앞부분 (좌우 통틀어 몇 개) */
  malformedSample: string[]
  /** 못 읽은 원인 추정. 짚을 수 없으면 빈 문자열 */
  malformedHint: string
  /** 팀 공용 제외 규칙 — 화면이 내 목록과 합쳐 적용한다 */
  exclude: SchemaExcludeInfo
}

/** 스키마 파일 하나 (= 날짜 한 벌) */
export interface SchemaSnapshotRef {
  /** 파일명에서 뽑은 날짜 (`2026-09-01`) — 목록의 식별자 */
  id: string
  /** 정렬용 키. 숫자만 남긴 것 */
  sortKey: string
}

/** `GET /api/v1/schemas/snapshots` 응답 */
export interface SchemaSnapshotListResponse {
  /** 화면에 보여줄 스키마 폴더 경로. 설정이 비어 있으면 빈 문자열 */
  root: string
  /** 환경 폴더별 날짜 목록 */
  left: SchemaSnapshotRef[]
  right: SchemaSnapshotRef[]
}

/**
 * `change/config.ts` 의 스키마 설정 — 파일 이름 규칙과 줄 형식.
 *
 * **위치는 여기가 아니라 프리셋의 `schemaRoot` 에 둔다.** 위치는 고치면 바로 반영되고
 * 형식은 서버를 다시 시작해야 하므로, 반영 시점이 다른 둘을 섞지 않는다.
 */
export interface SchemaConfig {
  /**
   * `<schemaRoot>/<환경폴더>/` 아래 파일 이름 규칙.
   * `{env}` 는 환경 폴더명, `{date}` 는 날짜 — **날짜 목록을 여기서 뽑는다.**
   */
  fileName: string
  /** 한 줄의 필드를 가르는 글자 */
  separator: string
  /**
   * 이 정규식에 걸리는 이름은 DB 가 자동으로 붙인 것으로 본다.
   *
   * Oracle 은 `NOT NULL` 컬럼마다 `SYS_C0011234` 같은 제약을 만드는데, 번호가
   * 데이터베이스마다 달라 **운영 ↔ 테스트에서 내용이 같아도 전부 변경으로 뜬다.**
   * 비우면 접지 않는다.
   */
  systemNamePattern: string
}

export const DEFAULT_SCHEMA_CONFIG: SchemaConfig = {
  fileName: 'snapshot_{env}_{date}.txt',
  separator: ',',
  systemNamePattern: '^(SYS_|BIN[$])',
}
