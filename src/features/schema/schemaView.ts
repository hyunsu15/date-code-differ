import { changedFirst } from '../../lib/changedFirst.ts'
import { snapshotSortKey } from '../../lib/fileTypes.ts'
import {
  SCHEMA_KINDS,
  type SchemaKind,
  type SchemaSnapshotRef,
  type TableDiff,
} from '../../types.ts'

/**
 * 스키마 화면이 쓰는 계산들 — 그리는 일과 떼어 둔다.
 *
 * 여기서 가장 중요한 것은 **날짜 맞추기**다. 스키마 덤프는 소스 배포와 주기가 달라
 * 고른 날짜에 딱 맞는 파일이 없는 것이 보통이다. 그때 조용히 아무거나 고르면 안 되고,
 * 아무것도 안 보여줘도 안 된다 — "그 시점에 걸려 있던 스키마" 를 골라 주고
 * **무엇을 골랐는지 화면에 적는다**.
 */

/** `YYYYMMDD` → 날 수. 키를 숫자로 빼면 달이 바뀔 때 거리가 틀린다 (0801 − 0731 = 70) */
const dayNumber = (key: string): number =>
  Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))) / 86_400_000

/**
 * 고른 날짜에 대응하는 스키마 날짜를 찾는다.
 *
 * 1. 같은 날짜가 있으면 그것
 * 2. 없으면 **날 수로 가장 가까운 것** — 앞이든 뒤든. 거리가 같으면 앞의 것
 *    (그 시점에 이미 걸려 있던 스키마)
 * 3. 날짜로 읽히지 않으면 가장 오래된 것
 *
 * 예전에는 "그 날짜 이하" 만 봤다. 그러면 하루 뒤 덤프를 두고 한 달 전 덤프를 고르고,
 * 이하가 하나도 없으면 맨 끝으로 튀어 사람이 보기에 무작위로 고른 것처럼 보였다.
 * 덤프는 배포 직후에 뜨는 경우가 많아, 바로 뒤의 덤프가 그날 상태에 더 가깝기도 하다.
 *
 * 목록은 최신순으로 들어온다 (서버가 그렇게 정렬해 보낸다).
 *
 * @returns 고른 날짜. 목록이 비어 있으면 빈 문자열
 */
export function matchSchemaDate(items: readonly SchemaSnapshotRef[], wanted: string): string {
  if (items.length === 0) return ''
  if (items.some((s) => s.id === wanted)) return wanted

  const key = snapshotSortKey(wanted)
  const dated = key ? items.filter((s) => s.sortKey) : []
  // 날짜로 읽히지 않으면 잴 거리가 없다 — 빈손으로 두는 것보다 낫고, 무엇을 골랐는지는 화면에 적힌다
  if (dated.length === 0) return items[items.length - 1].id

  const target = dayNumber(key)
  let best = dated[0]
  let bestGap = Infinity
  for (const s of dated) {
    const gap = Math.abs(dayNumber(s.sortKey) - target)
    if (gap < bestGap || (gap === bestGap && s.sortKey < best.sortKey)) {
      best = s
      bestGap = gap
    }
  }
  return best.id
}

/** 스키마 화면 상단에 뿌릴 요약 */
export interface SchemaSummary {
  tables: number
  changed: number
  /** 종류별 "변경된 테이블 수" — 밴드의 종류 필터가 쓴다 */
  changedByKind: Record<SchemaKind, number>
  /** 기본키가 움직인 테이블 수 */
  primaryKeyChanged: number
  /** 시스템 이름이라 접어 둔 줄 수 (양쪽 통틀어) */
  systemHidden: number
}

export function summarize(tables: readonly TableDiff[]): SchemaSummary {
  const changedByKind = { column: 0, constraint: 0, index: 0 } as Record<SchemaKind, number>
  let changed = 0
  let primaryKeyChanged = 0
  let systemHidden = 0

  let visible = 0

  for (const table of tables) {
    // 접어 둔 테이블은 분모에서도 뺀다 — 목록에 없는 것이 "7개 중" 에 들어 있으면
    // 화면의 숫자와 눈에 보이는 줄 수가 어긋난다
    if (table.excluded) continue
    visible += 1

    if (table.status !== 'same') changed += 1
    if (table.primaryKeyChanged) primaryKeyChanged += 1
    for (const kind of SCHEMA_KINDS) {
      systemHidden += table.sections[kind].systemHidden
      if (table.changedKinds.includes(kind)) changedByKind[kind] += 1
    }
  }

  return { tables: visible, changed, changedByKind, primaryKeyChanged, systemHidden }
}

/** 목록에 걸어 둘 조건 */
export interface TableFilter {
  /** 이름 검색 — 테이블명과 컬럼명을 함께 본다 */
  query: string
  onlyChanged: boolean
  /** 이 종류에 변경이 있는 테이블만. null 이면 전체 */
  kind: SchemaKind | null
  /** 접어 둔 테이블도 보여줄지 */
  showExcluded?: boolean
}

/**
 * 목록을 조건에 맞게 좁힌다.
 *
 * 검색은 **컬럼 이름까지 본다.** "이 컬럼이 어느 테이블에 있더라" 가 실제로 자주 묻는
 * 질문이고, 테이블명만 걸면 그걸 못 찾는다.
 *
 * 바뀐 테이블을 **위로** 올린다 — "변경된 테이블만" 을 끄고 전체를 볼 때 바뀐 것이 동일한 것 사이에
 * 흩어지지 않게 (`changedFirst`). 각 묶음 안은 이름순 그대로.
 */
export function filterTables(
  tables: readonly TableDiff[],
  { query, onlyChanged, kind, showExcluded = false }: TableFilter
): TableDiff[] {
  const needle = query.trim().toUpperCase()

  const shown = tables.filter((table) => {
    if (table.excluded && !showExcluded) return false
    if (onlyChanged && table.status === 'same') return false
    if (kind && !table.changedKinds.includes(kind)) return false
    if (!needle) return true
    if (table.name.toUpperCase().includes(needle)) return true
    return SCHEMA_KINDS.some((k) =>
      table.sections[k].rows.some((row) => row.name.toUpperCase().includes(needle))
    )
  })
  return changedFirst(shown)
}

/** 한 테이블에서 접어 둔 줄 수 (제외 목록·종류 토글) */
export const excludedRows = (table: TableDiff): number =>
  SCHEMA_KINDS.reduce((sum, kind) => sum + table.sections[kind].excludedHidden, 0)
