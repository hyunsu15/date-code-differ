import { fetchSchemaComparison, fetchSchemaSnapshots } from '../../api/client.ts'
import { applySchemaExclude, loadKindToggles } from '../schema/schemaExclude.ts'
import { matchSchemaDate } from '../schema/schemaView.ts'
import type { SourceConfig, TableDiff } from '../../types.ts'

interface SchemaForReportArgs {
  /** 환경 폴더를 붙이지 않은 프리셋 루트 (`SchemaPane` 과 같다) */
  source: SourceConfig
  leftEnv: string
  rightEnv: string
  sameSource: boolean
  /** 보고서에 실리는 소스 날짜 — 스키마는 여기에 가장 가까운 덤프로 맞춘다 */
  codeLeft: string
  codeRight: string
  /**
   * 맞추지 말고 **이 덤프 날짜 그대로** 쓴다 — 스키마 탭에서 스키마 보고서를 받을 때.
   * 화면에 보이는 것과 받은 문서가 같아야 한다. 이때는 `codeLeft/Right` 를 보지 않는다.
   */
  pinned?: { left: string; right: string }
  /** 내 스키마 제외 목록 원문 */
  myExclude: string
}

export interface SchemaForReport {
  /** 실제로 견준 덤프 날짜 */
  left: string
  right: string
  /** 제외 목록·종류 토글에 걸린 테이블을 뺀 것 */
  tables: TableDiff[]
  /**
   * 같은 환경인데 두 소스 날짜가 **같은 덤프**로 맞춰져 견주지 않았다.
   * 두 날짜 사이에 덤프가 없다는 뜻이라, 0건이 아니라 "비교 못 함" 이다.
   */
  sameDump: boolean
}

/** 소스 날짜마다 가장 가까운 덤프. 그 환경에 덤프가 없으면 빈 문자열 */
async function nearestDumps(args: SchemaForReportArgs): Promise<{ left: string; right: string }> {
  const list = await fetchSchemaSnapshots(args.source, args.leftEnv, args.rightEnv)
  return { left: matchSchemaDate(list.left, args.codeLeft), right: matchSchemaDate(list.right, args.codeRight) }
}

/**
 * 보고서에 넣을 스키마 대조를 그 자리에서 읽는다.
 *
 * 스키마는 탭을 열 때만 읽으므로(`App` · `SchemaPane`) 코드 탭에서 누르면 손에 든 것이 없다.
 * 날짜 목록 → 날짜 맞추기 → 대조 → 접기 순으로 밟는다.
 *
 * **날짜는 보고서의 소스 날짜에 맞춘다.** 스키마 탭에서 예전에 고른 날짜는 쓰지 않는다 —
 * 그 뒤에 소스 날짜를 바꿨으면 한 보고서 안에서 소스와 스키마가 서로 다른 시점을 말하게 된다.
 * 예외는 `pinned` — 스키마 탭에서 지금 보고 있는 스키마만 받을 때는 화면 그대로가 맞다.
 *
 * 화면 컨트롤의 순서 규칙(같은 환경이면 오른쪽이 더 최신)도 걸지 않는다. 두 날짜가 같은
 * 덤프로 맞춰졌을 때 그 규칙은 오른쪽을 다음 덤프로 밀어내는데, 그러면 7월 소스 비교에
 * 9월 스키마 변경이 실린다. 그때는 견주지 않고 `sameDump` 로 알린다.
 *
 * 접기는 화면과 같은 세 겹(팀 규칙 · 내 목록 · 종류 토글)을 얹는다 — 숫자가 화면과 같아야 한다.
 *
 * @returns 어느 한쪽이라도 덤프가 없으면 null
 */
export async function loadSchemaForReport(args: SchemaForReportArgs): Promise<SchemaForReport | null> {
  const { left, right } = args.pinned ?? (await nearestDumps(args))
  if (!left || !right) return null

  if (args.sameSource && left === right) return { left, right, tables: [], sameDump: true }

  const res = await fetchSchemaComparison(args.source, args.leftEnv, args.rightEnv, left, right)
  const folded = applySchemaExclude(res.tables, res.exclude.rules, args.myExclude, loadKindToggles())
  return {
    left: res.left,
    right: res.right,
    tables: folded.tables.filter((t) => !t.excluded),
    sameDump: false,
  }
}
