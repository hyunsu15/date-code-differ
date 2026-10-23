import { CONSTRAINT_LABEL } from '../../lib/schemaParse.ts'
import {
  SCHEMA_KINDS,
  SCHEMA_KIND_LABEL,
  STATUS_LABEL,
  type FileStatus,
  type SchemaCell,
  type SchemaKind,
  type SchemaRow,
  type SchemaSection,
  type TableDiff,
} from '../../types.ts'

/**
 * 스키마 변경을 **말로** 푼다 — 화면의 칩·범례와 보고서의 문장이 같은 말을 쓰게 한 곳에 둔다.
 *
 * **말은 세 개뿐이다: 추가 · 삭제 · 변경.** 늘 왼쪽 → 오른쪽(화면의 `운영 → 테스트` 화살표 방향)으로
 * 읽는다. 줄 색(초록 · 빨강 · 주황)이 이미 그 방향으로 뜻을 갖고 있어서, 말도 같아야 한다.
 *
 * 예전에는 환경이 다르면 `테스트에만` · `운영에만` · `타입 다름` 으로 따로 적었다. 어느 쪽이 맞는
 * 상태인지 단정하지 않으려던 것인데, 빨간 줄에 `운영에만` 이 붙으니 "운영에만 있고 삭제됐다" 로
 * 읽혀 오히려 헷갈렸다. 그래서 말은 하나로 두고, **범례가 각 말을 실제 이름으로 풀어 준다**
 * (`삭제 — 운영에는 있고 테스트에는 없음`). 어느 쪽이 맞는지 판단하지 않는다는 것도 범례가 말한다.
 */

/** 한쪽이 무엇인지 — 환경 이름과 날짜 */
export interface SideInfo {
  env: string
  date: string
}

/**
 * 보고서 표의 한 줄 — 테이블 · 구분 · 이름 · 내용 · 상태.
 * 상태는 **맨 끝**에 둔다(소스 표와 같다). 상태 말은 화면 줄 앞 칩과 같다(`rowLabel`).
 */
export type ChangeRow = [table: string, kind: string, name: string, detail: string, status: string]

const ROW_ORDER: Record<FileStatus, number> = { added: 0, removed: 1, modified: 2, same: 3 }

/** 한쪽 값을 사람이 읽는 모양으로 — `VARCHAR2(20) NOT NULL` · `비유니크 (ORD_STAT, ORD_DT)` */
function show(cell: SchemaCell): string {
  const body = cell.badge ? `${cell.badge} (${cell.value})` : cell.value
  return cell.note ? `${body} ${cell.note}` : body
}

/** 양쪽에 다 있는 줄에서 **무엇이** 다른가 — 칩과 문장이 이 목록 하나를 함께 본다 */
type Aspect = 'type' | 'notNull' | 'kind' | 'columns'

const ASPECT_LABEL: Record<Aspect, string> = {
  type: '타입',
  notNull: 'NOT NULL',
  kind: '종류',
  columns: '컬럼',
}

function aspects(kind: SchemaKind, left: SchemaCell, right: SchemaCell): Aspect[] {
  const out: Aspect[] = []
  if (kind === 'column') {
    if (left.value !== right.value) out.push('type')
    if (Boolean(left.note) !== Boolean(right.note)) out.push('notNull')
  } else {
    if (left.badge !== right.badge) out.push('kind')
    if (left.value !== right.value) out.push('columns')
  }
  return out
}

/** NOT NULL 은 값이 아니라 붙었는지 풀렸는지가 요점이다 */
const notNullText = (right: SchemaCell): string => (right.note ? 'NOT NULL 설정' : 'NOT NULL 해제')

/**
 * 줄 하나의 **짧은 이름** — 화면 줄 앞의 칩.
 * `추가` · `삭제` · `타입 변경` · `NOT NULL 설정` · `종류·컬럼 변경`.
 * 바뀌지 않은 줄은 빈 문자열 — 칩을 그리지 않는다.
 */
export function rowLabel(kind: SchemaKind, row: SchemaRow): string {
  if (row.left === null && row.right) return STATUS_LABEL.added
  if (row.right === null && row.left) return STATUS_LABEL.removed
  if (row.status === 'same' || !row.left || !row.right) return ''

  const found = aspects(kind, row.left, row.right)
  // NOT NULL 만 바뀌었으면 붙었는지 풀렸는지까지 말한다
  if (found.length === 1 && found[0] === 'notNull') return notNullText(row.right)
  const what = found.map((a) => ASPECT_LABEL[a]).join('·')
  return what ? `${what} ${STATUS_LABEL.modified}` : STATUS_LABEL.modified
}

/**
 * 줄 하나의 값 — 보고서의 "내용" 칸. 무엇이 바뀌었는지(상태)는 맨 끝 칸이 말하므로 여기는 값만.
 * 있는 쪽의 값, 바뀌었으면 `왼쪽 → 오른쪽`.
 */
function rowDetail(row: SchemaRow): string {
  if (row.left && row.right) return `${show(row.left)} → ${show(row.right)}`
  const only = row.left ?? row.right
  return only ? show(only) : '—'
}

/** 기본키가 걸린 줄 — 빈도는 낮고 위험은 커서(이관·중복) 눈에 띄게 표시한다 */
const isPrimaryKey = (row: SchemaRow): boolean =>
  row.left?.badge === CONSTRAINT_LABEL.P || row.right?.badge === CONSTRAINT_LABEL.P

/**
 * 통째로 생기거나 없어진 테이블의 짧은 이름 — 목록의 배지.
 * 바뀐 테이블·같은 테이블은 빈 문자열 (안에서 무엇이 바뀌었는지는 `kindSummary` 가 말한다).
 */
export function tableLabel(table: TableDiff): string {
  if (table.status === 'added' || table.status === 'removed') return `테이블 ${STATUS_LABEL[table.status]}`
  return ''
}

/**
 * 바뀐 테이블 안에서 종류별로 몇 줄이 바뀌었나 — `컬럼 4 · 제약 1 · 인덱스 2`.
 * 목록의 둘째 줄. 점과 `+2 −1 ~1` 을 늘어놓으면 어느 종류의 숫자인지 읽히지 않는다.
 */
export function kindSummary(table: TableDiff): string {
  return SCHEMA_KINDS.map((kind) => {
    const s = table.sections[kind]
    const n = s.added + s.removed + s.modified
    return n > 0 ? `${SCHEMA_KIND_LABEL[kind]} ${n.toLocaleString('ko-KR')}` : ''
  })
    .filter(Boolean)
    .join(' · ')
}

/** 섹션(컬럼·제약·인덱스) 머리의 집계 — `추가 2 · 삭제 1 · 변경 1`. 0 인 것은 뺀다 */
export function sectionSummary(
  section: Pick<SchemaSection, 'added' | 'removed' | 'modified'>
): { status: FileStatus; text: string }[] {
  return [
    { status: 'added' as const, n: section.added },
    { status: 'removed' as const, n: section.removed },
    { status: 'modified' as const, n: section.modified },
  ]
    .filter((x) => x.n > 0)
    .map((x) => ({ status: x.status, text: `${STATUS_LABEL[x.status]} ${x.n.toLocaleString('ko-KR')}` }))
}

/**
 * 범례에 쓸 양쪽 이름 — 갈리는 것만 적는다.
 * 같은 환경이면 날짜로(`2026-08-01`), 같은 날짜면 환경으로(`운영`), 둘 다 다르면 둘 다.
 */
export function sideNames(left: SideInfo, right: SideInfo): { left: string; right: string } {
  if (left.env === right.env) return { left: left.date, right: right.date }
  if (left.date === right.date) return { left: left.env, right: right.env }
  return { left: `${left.env} ${left.date}`, right: `${right.env} ${right.date}` }
}

/**
 * 색 · 말 범례 — 각 말을 **실제 이름으로** 푼다.
 *
 *   추가 (초록)   테스트에는 있고 운영에는 없음
 *   삭제 (빨강)   운영에는 있고 테스트에는 없음
 *   변경 (주황)   양쪽에 다 있지만 값이 다름
 *
 * 환경이 달라도 같은 말로 읽힌다 — "추가" 가 무엇을 뜻하는지 이 한 줄이 못 박는다.
 */
export function changeLegend(names: { left: string; right: string }): {
  status: Exclude<FileStatus, 'same'>
  word: string
  meaning: string
  /**
   * 어느 쪽에 **있는** 것인가 — 추가는 오른쪽, 삭제는 왼쪽, 변경은 양쪽(null).
   * 화면이 `meaning` 의 이름 자리를 열 머리와 같은 환경 색 태그로 그릴 때 쓴다.
   */
  has: 'left' | 'right' | null
}[] {
  return [
    {
      status: 'added',
      word: STATUS_LABEL.added,
      meaning: `${names.right}에는 있고 ${names.left}에는 없음`,
      has: 'right',
    },
    {
      status: 'removed',
      word: STATUS_LABEL.removed,
      meaning: `${names.left}에는 있고 ${names.right}에는 없음`,
      has: 'left',
    },
    { status: 'modified', word: STATUS_LABEL.modified, meaning: '양쪽에 다 있지만 값이 다름', has: null },
  ]
}

/**
 * 통째로 생기거나 없어진 테이블 — 개수가 아니라 **무엇이 들었는지 이름으로** 적는다.
 * `컬럼: ORD_NO, ORD_DT · 제약: PK_ORD · 인덱스: IX_ORD_01`. 개수만으로는 공지를 받은 사람이
 * 어떤 테이블인지 알 수 없었다. 접어 둔 줄(제외 목록·종류 토글)은 뺀다.
 */
function wholeTableDetail(table: TableDiff): string {
  const parts = SCHEMA_KINDS.map((kind) => {
    const names = table.sections[kind].rows.filter((row) => !row.excluded).map((row) => row.name)
    return names.length > 0 ? `${SCHEMA_KIND_LABEL[kind]}: ${names.join(', ')}` : ''
  }).filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

/**
 * 바뀐 테이블들을 보고서 표의 줄로 편다.
 *
 * 순서: 생긴 테이블 → 없어진 테이블 → 바뀐 테이블 (같은 상태 안에서는 이름순).
 * 바뀐 테이블 안에서는 컬럼 → 제약 → 인덱스, 그 안에서 추가 → 삭제 → 변경 순이다.
 * 접어 둔 줄(제외 목록·종류 토글)은 빼고, 시스템 이름 줄은 애초에 `rows` 에 없다.
 */
export function schemaChangeRows(tables: readonly TableDiff[]): ChangeRow[] {
  const changed = tables
    .filter((t) => t.status !== 'same')
    .sort((a, b) => ROW_ORDER[a.status] - ROW_ORDER[b.status] || a.name.localeCompare(b.name))

  const out: ChangeRow[] = []
  for (const table of changed) {
    if (table.status !== 'modified') {
      out.push([table.name, '테이블', '—', wholeTableDetail(table), tableLabel(table)])
      continue
    }
    for (const kind of SCHEMA_KINDS) {
      const rows = table.sections[kind].rows
        .filter((row) => !row.excluded && row.status !== 'same')
        .sort((a, b) => ROW_ORDER[a.status] - ROW_ORDER[b.status] || a.name.localeCompare(b.name))
      for (const row of rows) {
        const warn = kind === 'constraint' && isPrimaryKey(row) ? '⚠ 기본키 · ' : ''
        out.push([table.name, SCHEMA_KIND_LABEL[kind], row.name, rowDetail(row), warn + rowLabel(kind, row)])
      }
    }
  }
  return out
}
