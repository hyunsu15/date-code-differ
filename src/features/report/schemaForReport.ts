import { fetchSchemaComparison, fetchSchemaSnapshots } from '../../api/client.ts'
import { applySchemaExclude, loadKindToggles } from '../schema/schemaExclude.ts'
import { matchSchemaDate } from '../schema/schemaView.ts'
import { normalizeSelection, type Selection } from '../snapshots/selection.ts'
import type { Snapshot, SourceConfig, TableDiff } from '../../types.ts'

interface SchemaForReportArgs {
  /** 환경 폴더를 붙이지 않은 프리셋 루트 (`SchemaPane` 과 같다) */
  source: SourceConfig
  leftEnv: string
  rightEnv: string
  sameSource: boolean
  /** 스키마 탭에서 고른 날짜. 아직 안 열었으면 빈 선택 */
  picked: Selection
  /** 코드에서 고른 날짜 — 스키마 탭을 안 열었으면 여기에 맞춘다 */
  codeLeft: string
  codeRight: string
  /** 내 스키마 제외 목록 원문 */
  myExclude: string
}

export interface SchemaForReport {
  left: string
  right: string
  /** 제외 목록·종류 토글에 걸린 테이블을 뺀 것 */
  tables: TableDiff[]
}

/**
 * 보고서에 넣을 스키마 대조를 그 자리에서 읽는다.
 *
 * 스키마는 탭을 열 때만 읽으므로(`App` · `SchemaPane`) 코드 탭에서 누르면 손에 든 것이 없다.
 * 화면이 하는 순서를 그대로 밟는다 — 날짜 목록 → 날짜 맞추기 → 대조 → 접기.
 * 날짜 목록은 **매번 새로 읽는다.** 스키마 탭을 본 뒤 환경을 바꿨으면 들고 있던
 * 선택이 옛 환경의 것이라, 새 목록에 대고 바로잡아야 한다.
 *
 * 접기는 화면과 같은 세 겹(팀 규칙 · 내 목록 · 종류 토글)을 얹는다 — 숫자가 화면과 같아야 한다.
 *
 * @returns 고를 날짜가 없으면 null (그 환경에 덤프가 없다)
 */
export async function loadSchemaForReport(args: SchemaForReportArgs): Promise<SchemaForReport | null> {
  const list = await fetchSchemaSnapshots(args.source, args.leftEnv, args.rightEnv)
  const toItems = (refs: { id: string; sortKey: string }[]): Snapshot[] =>
    refs.map((r) => ({ ...r, fileCount: 0, packageCount: 0 }))
  const leftItems = toItems(list.left)
  const rightItems = toItems(list.right)

  const want =
    args.picked.left || args.picked.right
      ? args.picked
      : {
          left: matchSchemaDate(leftItems, args.codeLeft),
          right: matchSchemaDate(rightItems, args.codeRight),
        }
  const { left, right } = normalizeSelection(want, leftItems, rightItems, args.sameSource)
  if (!left || !right) return null

  const res = await fetchSchemaComparison(args.source, args.leftEnv, args.rightEnv, left, right)
  const folded = applySchemaExclude(res.tables, res.exclude.rules, args.myExclude, loadKindToggles())
  return { left: res.left, right: res.right, tables: folded.tables.filter((t) => !t.excluded) }
}
