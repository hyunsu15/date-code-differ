import { DEFAULT_EXCLUDE_SEPARATORS, ExcludeList } from '../../lib/excludeList.ts'
import { recountTable } from '../../lib/schemaDiff.ts'
import { SCHEMA_KINDS, type SchemaKind, type TableDiff } from '../../types.ts'

/**
 * 스키마 비교에서 접어 둘 것들.
 *
 * 소스 비교와 같은 두 겹이다 — **팀이 함께 쓰는 규칙 파일**(프리셋의
 * `schemaExcludeFile`, 서버가 읽어 규칙만 실어 보낸다)과 **내 목록**(이 브라우저).
 * 여기에 **종류 토글**(컬럼·제약·인덱스 통째로 끄기)이 하나 더 얹힌다.
 *
 * ## 문법은 소스 제외 목록 그대로다
 *
 * 대상이 파일 경로가 아니라 테이블과 그 안의 이름일 뿐이라, `.` 을 `/` 로 바꿔
 * `excludeList.ts` 에 그대로 넘긴다. 판정 엔진을 새로 만들지 않는다 — 두 목록이 다른
 * 문법을 가지면 어느 쪽에 무엇을 적었는지 기억해야 한다.
 *
 * | 적는 것 | 걸리는 것 |
 * | --- | --- |
 * | `TB_ORD_BAK` | 그 테이블과 그 아래 전부 |
 * | `TB_ORD.ORD_MEMO` | 그 테이블의 그 컬럼만 |
 * | `*.REG_DTM` | 모든 테이블의 그 컬럼 (감사 컬럼) |
 * | `IX_*_TMP` | 이름이 맞는 인덱스·제약 (어느 테이블이든) |
 *
 * 테이블 이름만 적으면 그 아래까지 걸리는 것은 글로브 규칙이 폴더를 다루는 방식과 같다
 * (`excludeList.toRegExp` 의 끝 `(?:/.*)?`). 그래서 따로 다룰 자리가 없다.
 *
 * ## 거르는 게 아니라 접는다
 *
 * 걸린 것도 대조는 그대로 했고 목록에서만 접는다. 접힌 수와 **그중 바뀐 수**를 늘
 * 남긴다 — 접어 둔 자리에 들어온 변경이 조용히 묻히면, 안 보이는 게 아니라 없는 것이
 * 되어 버린다.
 *
 * ## 세는 일은 한 자리에서만
 *
 * 접기를 얹은 뒤 숫자는 `schemaDiff.recountTable` 이 다시 낸다. 서버가 센 값을 화면이
 * 또 고치면 요약과 목록이 어긋난다.
 */

const STORAGE_KEY = 'cd-my-exclude-schema'
const KIND_STORAGE_KEY = 'cd-schema-kinds'

export function loadMySchemaExclude(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveMySchemaExclude(text: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, text)
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}

/** 켜 둔 종류들. 없으면 셋 다 켠 상태 */
export type KindToggles = Record<SchemaKind, boolean>

export const ALL_KINDS: KindToggles = { column: true, constraint: true, index: true }

export function loadKindToggles(): KindToggles {
  try {
    const raw = localStorage.getItem(KIND_STORAGE_KEY)
    if (!raw) return { ...ALL_KINDS }
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>
    const out = { ...ALL_KINDS }
    for (const kind of SCHEMA_KINDS) {
      if (parsed[kind] === false) out[kind] = false
    }
    return out
  } catch {
    return { ...ALL_KINDS }
  }
}

export function saveKindToggles(toggles: KindToggles): void {
  try {
    localStorage.setItem(KIND_STORAGE_KEY, JSON.stringify(toggles))
  } catch {
    // 위와 같음
  }
}

/**
 * 스키마 이름을 제외 규칙이 보는 모양으로 바꾼다.
 * `TB_ORD.ORD_MEMO` → `TB_ORD/ORD_MEMO`
 */
const toPath = (table: string, member?: string): string =>
  member === undefined ? table : `${table}/${member}`

/** 목록 원문을 규칙으로. 적을 때 쓰는 `.` 을 경로 구분자로 옮긴다 */
export const parseSchemaExclude = (text: string): ExcludeList =>
  ExcludeList.parse(text.split('.').join('/'), DEFAULT_EXCLUDE_SEPARATORS)

/**
 * 이름 하나를 목록에 넣거나 뺀다.
 *
 * **뺄 때는 그 이름이 아니라 걸린 규칙을 지운다.** `*.REG_DTM` 에 걸려 접힌 컬럼에서
 * "펼치기" 를 누르면 그 컬럼 이름만 지워서는 아무 일도 안 일어나 버튼이 고장 난 것처럼
 * 보인다 (`settings/localExclude.toggleLocalExclude` 와 같은 이유).
 */
export function toggleSchemaExclude(text: string, table: string, member?: string): string {
  const target = member === undefined ? table : `${table}.${member}`
  const matched = parseSchemaExclude(text).matches(toPath(table, member))

  if (matched === null) {
    const trimmed = text.trimEnd()
    return trimmed ? `${trimmed}\n${target}` : target
  }

  // 규칙 원문은 `/` 로 저장돼 있으므로 사람이 적은 모양(`.`)으로 되돌려 견준다
  const written = matched.split('/').join('.')
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .split(',')
        .filter((piece) => piece.trim() !== written)
        .join(',')
    )
    .filter((line, i, all) => line.trim() !== '' || (i > 0 && all[i - 1].trim() !== ''))
    .join('\n')
    .trim()
}

/** 접기를 얹은 결과 */
export interface SchemaExcludeResult {
  tables: TableDiff[]
  /** 접힌 테이블 수 */
  excludedTables: number
  /** 접힌 테이블 중 실제로 바뀐 수 */
  excludedTablesChanged: number
  /** 접힌 줄 수 (컬럼·제약·인덱스 통틀어) */
  excludedRows: number
  /** 접힌 줄 중 실제로 바뀐 수 */
  excludedRowsChanged: number
  /** 그중 내 목록 때문에 접힌 수 (테이블 + 줄) */
  byMine: number
  /** 종류 토글로 통째로 끈 종류들 */
  offKinds: SchemaKind[]
}

interface Applied {
  excluded: boolean
  excludedBy: string | null
  excludedLocal: boolean
}

/**
 * 팀 규칙 + 내 목록 + 종류 토글을 대조 결과에 얹는다.
 *
 * 원본을 고치지 않는다 — 목록을 다시 계산할 때마다 서버 응답에서 새로 시작해야
 * 규칙을 지웠을 때 되돌아온다.
 */
export function applySchemaExclude(
  tables: readonly TableDiff[],
  teamRules: readonly string[],
  myText: string,
  kinds: KindToggles = ALL_KINDS
): SchemaExcludeResult {
  const team = parseSchemaExclude(teamRules.join('\n'))
  const mine = parseSchemaExclude(myText)

  /**
   * 팀 규칙을 먼저 본다 — 같은 것을 양쪽에 적었으면 고칠 자리는 팀 파일이다.
   *
   * 걸린 규칙은 **사람이 적은 모양(`.`)으로 되돌려** 돌려준다. 안쪽에서만 쓰는
   * 경로 형태(`TB_ORD/REG_DTM`)가 화면에 나오면, 그대로 목록에 옮겨 적었을 때
   * 안 걸린다.
   */
  const judge = (path: string): Applied => {
    const written = (rule: string): string => rule.split('/').join('.')

    const byTeam = team.matches(path)
    if (byTeam !== null) {
      return { excluded: true, excludedBy: written(byTeam), excludedLocal: false }
    }
    const byMine = mine.matches(path)
    if (byMine !== null) {
      return { excluded: true, excludedBy: written(byMine), excludedLocal: true }
    }
    return { excluded: false, excludedBy: null, excludedLocal: false }
  }

  const result: SchemaExcludeResult = {
    tables: [],
    excludedTables: 0,
    excludedTablesChanged: 0,
    excludedRows: 0,
    excludedRowsChanged: 0,
    byMine: 0,
    offKinds: SCHEMA_KINDS.filter((kind) => !kinds[kind]),
  }

  for (const source of tables) {
    const tableMark = judge(source.name)

    const sections = {} as TableDiff['sections']
    for (const kind of SCHEMA_KINDS) {
      const section = source.sections[kind]
      const rows = section.rows.map((row) => {
        // 종류를 통째로 껐으면 규칙을 볼 것도 없다. 테이블이 접혔으면 그 아래도 함께다
        if (!kinds[kind]) return { ...row, excluded: true, excludedBy: null, excludedLocal: false }
        if (tableMark.excluded) return { ...row, ...tableMark }

        const mark = judge(toPath(source.name, row.name))
        if (!mark.excluded) return { ...row, excluded: false, excludedBy: null }

        result.excludedRows += 1
        if (row.status !== 'same') result.excludedRowsChanged += 1
        if (mark.excludedLocal) result.byMine += 1
        return { ...row, ...mark }
      })

      sections[kind] = { ...section, rows }
    }

    const table = recountTable({ ...source, sections, ...tableMark })
    if (tableMark.excluded) {
      result.excludedTables += 1
      if (table.status !== 'same') result.excludedTablesChanged += 1
      if (tableMark.excludedLocal) result.byMine += 1
    }
    result.tables.push(table)
  }

  return result
}
