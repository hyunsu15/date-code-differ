/**
 * 좌우 스키마 한 벌씩을 **이름으로 짝지어** 대조한다.
 *
 * 줄 단위 diff 를 쓰지 않는다. 덤프는 컬럼 순서·정렬 공백·시퀀스 값 때문에 텍스트로
 * 견주면 노이즈가 대부분을 차지하고, 정작 알고 싶은 "`ORD_AMT` 가 `NUMBER(15,2)` 에서
 * `NUMBER(18,2)` 로 늘었다" 는 그 안에 묻힌다. 이름으로 짝지으면 순서가 어긋나도
 * 흔들리지 않고, 바뀐 것만 한 줄 안에서 보인다.
 *
 * 값을 다듬는 일(타입 합치기 · 시스템 이름 표시 · 다중 컬럼 묶기)은 이미
 * `schemaParse.ts` 가 끝내 두었다. 여기서는 짝짓기와 세기만 한다.
 */

import { CONSTRAINT_LABEL } from './schemaParse.ts'
import {
  SCHEMA_KINDS,
  type SchemaCell,
  type SchemaColumn,
  type SchemaConstraint,
  type SchemaIndex,
  type SchemaItemStatus,
  type SchemaKind,
  type SchemaRow,
  type SchemaSection,
  type SchemaSnapshot,
  type TableDiff,
  type TableSchema,
} from '../types.ts'

/** 컬럼 한 줄의 표시값 — 타입과 NOT NULL 여부를 함께 견준다 */
export function columnCell(column: SchemaColumn): SchemaCell {
  // 널 허용이 보통이라 표시하지 않는다. 눈에 띄어야 하는 쪽은 NOT NULL 이다
  return { badge: null, value: column.nullable ? column.type : `${column.type} NN` }
}

export function constraintCell(constraint: SchemaConstraint): SchemaCell {
  // 모르는 종류는 딕셔너리 원문을 그대로 보여준다 — 임의로 뭉뚱그리지 않는다
  const label =
    constraint.kind === 'other' && constraint.rawKind
      ? constraint.rawKind
      : CONSTRAINT_LABEL[constraint.kind]
  return { badge: label, value: constraint.columns.join(', ') }
}

export function indexCell(index: SchemaIndex): SchemaCell {
  return { badge: index.unique ? '유니크' : '비유니크', value: index.columns.join(', ') }
}

const sameCell = (a: SchemaCell | null, b: SchemaCell | null): boolean =>
  a !== null && b !== null && a.badge === b.badge && a.value === b.value

function statusOf(left: SchemaCell | null, right: SchemaCell | null): SchemaItemStatus {
  if (left === null) return 'added'
  if (right === null) return 'removed'
  return sameCell(left, right) ? 'same' : 'modified'
}

/** 짝짓기 전의 항목 하나 — 세 종류가 같은 모양으로 들어온다 */
interface Item {
  name: string
  cell: SchemaCell
  systemNamed: boolean
}

const toItems = <T>(
  list: readonly T[],
  name: (v: T) => string,
  cell: (v: T) => SchemaCell,
  systemNamed: (v: T) => boolean
): Item[] => list.map((v) => ({ name: name(v), cell: cell(v), systemNamed: systemNamed(v) }))

/**
 * 좌우 목록을 이름으로 짝지으면서 **읽는 순서를 지킨다.**
 *
 * 오른쪽(이후) 순서를 뼈대로 삼는다 — 사람이 보는 것은 바뀐 뒤의 테이블이라
 * 그 순서대로 늘어놓아야 실제 컬럼 배치와 같이 읽힌다. 왼쪽에만 있는 항목(삭제)은
 * 원래 자리에 흘려보내 맥락을 잃지 않게 한다.
 *
 * 이름을 알파벳순으로 다시 세우지 않는다. 그러면 컬럼 하나가 추가될 때마다 표 전체가
 * 다른 자리로 밀려 "무엇이 바뀌었는지" 대신 "어디가 움직였는지" 를 읽게 된다.
 */
function mergeByName(left: readonly Item[], right: readonly Item[]): SchemaRow[] {
  const leftByName = new Map(left.map((item) => [item.name, item]))
  const rightByName = new Map(right.map((item) => [item.name, item]))

  const rows: SchemaRow[] = []
  const done = new Set<string>()
  let cursor = 0

  /** 왼쪽에만 있는 항목을 원래 자리에 내보낸다 */
  const flushLeftOnly = (item: Item): void => {
    if (rightByName.has(item.name) || done.has(item.name)) return
    done.add(item.name)
    rows.push(toRow(item.name, item.cell, null, item.systemNamed))
  }

  for (const item of right) {
    // 왼쪽에도 있는 이름이면, 그 자리까지의 왼쪽 전용 항목들을 먼저 흘려보낸다.
    // 왼쪽에 없는 이름이라면 커서를 움직이지 않는다 — 움직이면 뒤따르는 짝을 놓친다
    if (leftByName.has(item.name)) {
      while (cursor < left.length && left[cursor].name !== item.name) {
        flushLeftOnly(left[cursor])
        cursor += 1
      }
      cursor += 1
    }
    if (done.has(item.name)) continue
    done.add(item.name)

    const other = leftByName.get(item.name) ?? null
    rows.push(
      toRow(item.name, other?.cell ?? null, item.cell, item.systemNamed || !!other?.systemNamed)
    )
  }

  for (; cursor < left.length; cursor += 1) flushLeftOnly(left[cursor])
  return rows
}

const toRow = (
  name: string,
  left: SchemaCell | null,
  right: SchemaCell | null,
  systemNamed: boolean
): SchemaRow => ({ name, status: statusOf(left, right), left, right, systemNamed })

/**
 * 한 섹션(컬럼·제약·인덱스)을 만든다.
 *
 * **시스템이 이름을 붙인 줄은 접는다.** 세지도 않는다 — 세면 내용이 같은데도 테이블이
 * "변경" 으로 올라와, 운영 ↔ 테스트 비교에서 목록 전체가 붉어진다. 대신 몇 개를
 * 접었는지는 남겨 둔다 (`systemHidden`). 조용히 지우면 접은 자리에 진짜 변경이
 * 섞여 들어와도 아무도 모른 채 지나간다.
 */
function buildSection(kind: SchemaKind, left: readonly Item[], right: readonly Item[]): SchemaSection {
  const section: SchemaSection = {
    kind,
    rows: [],
    added: 0,
    removed: 0,
    modified: 0,
    total: 0,
    systemHidden: 0,
    // 제외 목록은 화면이 얹는다 (features/schema/schemaExclude.ts) — 여기서는 0 이다
    excludedHidden: 0,
    excludedChanged: 0,
  }

  for (const row of mergeByName(left, right)) {
    if (row.systemNamed) {
      section.systemHidden += 1
      continue
    }
    section.rows.push(row)
  }

  return recountSection(section)
}

/**
 * 섹션의 숫자를 줄에서 다시 낸다.
 *
 * **접어 둔 줄은 세지 않는다.** 세면 내용이 그대로인데도 테이블이 "변경" 으로 올라와,
 * 접어 둔 보람이 없어진다. 대신 몇 개를 접었는지와 그중 바뀐 수는 남긴다 —
 * 접은 자리에 들어온 변경이 조용히 묻히면 안 된다.
 *
 * 화면이 제외 목록·종류 토글을 얹은 뒤 다시 부른다
 * (`features/schema/schemaExclude.ts`). 세는 규칙이 두 군데로 갈리면
 * 요약 숫자와 목록이 어긋난다.
 */
export function recountSection(section: SchemaSection): SchemaSection {
  section.added = 0
  section.removed = 0
  section.modified = 0
  section.total = 0
  section.excludedHidden = 0
  section.excludedChanged = 0

  for (const row of section.rows) {
    if (row.excluded) {
      section.excludedHidden += 1
      if (row.status !== 'same') section.excludedChanged += 1
      continue
    }
    section.total += 1
    if (row.status === 'added') section.added += 1
    else if (row.status === 'removed') section.removed += 1
    else if (row.status === 'modified') section.modified += 1
  }

  return section
}

/**
 * 테이블의 숫자를 섹션에서 다시 낸다 (화면이 접기를 얹은 뒤 부른다).
 *
 * **신규·삭제는 그대로 둔다.** 테이블 자체가 생기거나 없어진 사실은
 * 그 안의 줄 몇 개를 접었다고 달라지지 않는다.
 */
export function recountTable(table: TableDiff): TableDiff {
  for (const kind of SCHEMA_KINDS) recountSection(table.sections[kind])

  table.changedKinds = SCHEMA_KINDS.filter((kind) => changedIn(table.sections[kind]) > 0)

  if (table.status === 'modified' || table.status === 'same') {
    table.status = table.changedKinds.length > 0 ? 'modified' : 'same'
    table.primaryKeyChanged = table.sections.constraint.rows.some(
      (row) =>
        !row.excluded &&
        row.status !== 'same' &&
        (row.left?.badge === CONSTRAINT_LABEL.P || row.right?.badge === CONSTRAINT_LABEL.P)
    )
  }

  return table
}

const EMPTY_TABLE: TableSchema = { name: '', columns: [], constraints: [], indexes: [] }

function itemsOf(table: TableSchema, kind: SchemaKind): Item[] {
  if (kind === 'column') {
    return toItems(
      table.columns,
      (c) => c.name,
      columnCell,
      () => false
    )
  }
  if (kind === 'constraint') {
    return toItems(
      table.constraints,
      (c) => c.name,
      constraintCell,
      (c) => c.systemNamed
    )
  }
  return toItems(
    table.indexes,
    (i) => i.name,
    indexCell,
    (i) => i.systemNamed
  )
}

function diffTable(name: string, left: TableSchema | null, right: TableSchema | null): TableDiff {
  const sections = {} as Record<SchemaKind, SchemaSection>
  for (const kind of SCHEMA_KINDS) {
    sections[kind] = buildSection(kind, itemsOf(left ?? EMPTY_TABLE, kind), itemsOf(right ?? EMPTY_TABLE, kind))
  }

  const changedKinds = SCHEMA_KINDS.filter((kind) => changedIn(sections[kind]) > 0)

  // 기본키 변경은 빈도가 낮고 위험이 크다 — 목록에서 따로 눈에 띄게 알린다.
  //
  // **양쪽에 다 있는 테이블에서만 본다.** 신규·삭제 테이블은 기본키까지 통째로
  // 생기거나 없어지는 것이 당연해서, 거기에 경고를 붙이면 알림이 흔해져 정작
  // "쓰던 테이블의 키가 움직였다" 는 진짜 위험 신호가 묻힌다.
  const primaryKeyChanged =
    left !== null &&
    right !== null &&
    sections.constraint.rows.some(
      (row) =>
        row.status !== 'same' &&
        (row.left?.badge === CONSTRAINT_LABEL.P || row.right?.badge === CONSTRAINT_LABEL.P)
    )

  return {
    name,
    status: tableStatus(left, right, changedKinds.length > 0),
    sections,
    primaryKeyChanged,
    changedKinds,
  }
}

const changedIn = (section: SchemaSection): number =>
  section.added + section.removed + section.modified

function tableStatus(
  left: TableSchema | null,
  right: TableSchema | null,
  changed: boolean
): SchemaItemStatus {
  if (left === null) return 'added'
  if (right === null) return 'removed'
  return changed ? 'modified' : 'same'
}

/**
 * 두 스냅샷의 모든 테이블을 대조한다.
 *
 * 한쪽에만 있는 테이블도 결과에 넣는다 — 신규 테이블의 컬럼이 전부 `신규` 로 뜨는 것이
 * "테이블이 하나 늘었다" 만 아는 것보다 쓸모 있다. 이름순으로 돌려주고, 정렬·필터는
 * 화면이 한다.
 */
export function compareSchemas(left: SchemaSnapshot, right: SchemaSnapshot): TableDiff[] {
  const leftByName = new Map(left.tables.map((t) => [t.name, t]))
  const rightByName = new Map(right.tables.map((t) => [t.name, t]))

  const names = [...new Set([...leftByName.keys(), ...rightByName.keys()])].sort()
  return names.map((name) =>
    diffTable(name, leftByName.get(name) ?? null, rightByName.get(name) ?? null)
  )
}

/** 테이블 하나에 변경이 있는지 */
export const isChanged = (table: TableDiff): boolean => table.status !== 'same'
