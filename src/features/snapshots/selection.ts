import { snapshotSortKey } from '../../lib/fileTypes.ts'
import type { Snapshot } from '../../types.ts'

/** 비교할 좌우 스냅샷 한 쌍 */
export interface Selection {
  /** 기준이 되는 쪽 */
  left: string
  /** 견줄 쪽. 좌우가 같은 위치라면 항상 left 보다 최신이다 */
  right: string
}

export const EMPTY_SELECTION: Selection = { left: '', right: '' }

/**
 * 스냅샷 목록은 **최신순**이므로 index 가 작을수록 최신이다.
 *
 * `이후` 가 `이전` 보다 최신이어야 한다는 규칙은 **좌우가 같은 위치일 때만** 성립한다.
 * 환경이 다르면 얘기가 달라진다 — 운영 9/1 과 테스트 8/15 를 견주는 것은 거꾸로 된
 * 비교가 아니라 "테스트가 뒤처져 있다" 는 정상적인 질문이다. 환경마다 배포 시점이
 * 다르니 오히려 그쪽이 흔하다. 그래서 아래 함수들은 `sameSource` 를 함께 받는다.
 */
export const indexOfSnapshot = (snapshots: readonly Snapshot[], id: string): number =>
  snapshots.findIndex((s) => s.id === id)

/**
 * `이전` 으로 고를 수 있는 목록.
 * 같은 위치라면 가장 최신은 그보다 뒤(이후)가 없어 제외한다.
 */
export const leftChoices = (snapshots: readonly Snapshot[], sameSource: boolean): Snapshot[] =>
  sameSource ? snapshots.slice(1) : [...snapshots]

/**
 * `이후` 로 고를 수 있는 목록.
 * 같은 위치라면 고른 `이전` 보다 최신인 것만, 다른 위치라면 그쪽 목록 전부다.
 */
export function rightChoices(
  snapshots: readonly Snapshot[],
  left: string,
  sameSource: boolean
): Snapshot[] {
  if (!sameSource) return [...snapshots]
  const li = indexOfSnapshot(snapshots, left)
  return li < 0 ? [] : snapshots.slice(0, li)
}

/**
 * 원하는 선택을 규칙에 맞게 바로잡는다.
 * 목록이 바뀌었거나 `이전` 을 옮겨 `이후` 가 더 이상 최신이 아니게 된 경우를 여기서 흡수한다.
 *
 * **같은 위치일 때** (`leftSnapshots === rightSnapshots` 인 한 목록)
 * - `keepSameDate` 면 좌우가 **같은 날짜**여도 그대로 둔다 — 지난주 프리셋이 "그 주엔 새 폴더가 없었다
 *   (바뀐 것 없음)" 를 보여줄 때 생긴다(`lastWeekSelection`). 쌍을 통째로 고를 때와 새로고침에서만 켠다 —
 *   환경을 바꾸다 우연히 같은 이름이 남은 것까지 붙잡으면 빈 비교가 뜬다. 칸의 고르기 목록에는 여전히 안 나온다.
 * - 스냅샷이 2개 미만이면 비교 자체가 불가능하므로 빈 선택을 돌려준다.
 * - `이전` 이 목록에 없거나 가장 최신이면 두 번째로 최신인 것으로 옮긴다.
 * - `이후` 가 목록에 없거나 `이전` 보다 오래됐으면 `이전` 바로 위(한 칸 더 최신)로 옮긴다.
 *
 * **다른 위치일 때**
 * - 순서 규칙이 없다. 각자 자기 목록 안에 있기만 하면 되고, 없으면 그쪽 최신으로 간다.
 * - 한쪽이라도 비어 있으면 비교할 것이 없다.
 */
export function normalizeSelection(
  want: Selection,
  leftSnapshots: readonly Snapshot[],
  rightSnapshots: readonly Snapshot[],
  sameSource: boolean,
  keepSameDate = false
): Selection {
  if (!sameSource) {
    if (leftSnapshots.length === 0 || rightSnapshots.length === 0) return EMPTY_SELECTION
    const pick = (snapshots: readonly Snapshot[], id: string): string =>
      indexOfSnapshot(snapshots, id) >= 0 ? id : snapshots[0].id
    return { left: pick(leftSnapshots, want.left), right: pick(rightSnapshots, want.right) }
  }

  const snapshots = leftSnapshots
  if (keepSameDate && want.left === want.right && indexOfSnapshot(snapshots, want.left) >= 0) return want
  if (snapshots.length < 2) return EMPTY_SELECTION

  const wantedLeft = indexOfSnapshot(snapshots, want.left)
  const li = wantedLeft < 1 ? 1 : wantedLeft

  const wantedRight = indexOfSnapshot(snapshots, want.right)
  const ri = wantedRight < 0 || wantedRight >= li ? li - 1 : wantedRight

  return { left: snapshots[li].id, right: snapshots[ri].id }
}

/** `YYYYMMDD` 에서 며칠 앞의 `YYYYMMDD` — 달·해 넘김은 Date 가 맡는다 (시간대 영향이 없게 UTC 로 센다) */
export function daysBefore(sortKey: string, days: number): string {
  const at = Date.UTC(Number(sortKey.slice(0, 4)), Number(sortKey.slice(4, 6)) - 1, Number(sortKey.slice(6, 8)))
  return new Date(at - days * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '')
}

/** 지난주 프리셋이 견주는 두 금요일 (`YYYYMMDD`) */
export interface WeekRange {
  /** 지지난주 금요일 — 이 날 깔려 있던 것이 `이전` */
  from: string
  /** 지난주 금요일 — 이 날 깔려 있던 것이 `이후` */
  to: string
}

/**
 * 오늘 기준 **지지난주 금요일 → 지난주 금요일**. 주는 월~일로 센다 —
 * 월요일이든 일요일이든 "지난주 금요일" 은 바로 앞 주의 금요일이다 (10-26 월 · 11-01 일 → 10-23).
 * 날짜는 사용자 PC 시계(로컬 시간)로 정한다.
 */
export function lastWeekRange(today: Date): WeekRange {
  const fromMonday = (today.getDay() + 6) % 7 // 월=0 … 일=6
  // 이번 주 월요일의 3일 전 = 지난주 금요일
  const friday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - fromMonday - 3)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const to = `${friday.getFullYear()}${pad(friday.getMonth() + 1)}${pad(friday.getDate())}`
  return { from: daysBefore(to, 7), to }
}

/**
 * **지난주 프리셋** — 지지난주 금요일 시점(`이전`)과 지난주 금요일 시점(`이후`)을 견준다.
 *
 * - 그 금요일에 날짜 폴더가 없으면 **그보다 앞의 가장 가까운 날짜**를 쓴다 — 배포가 없던 날은 폴더도 없으니,
 *   그날 깔려 있던 것은 바로 앞 배포본이다. 그래야 그 주에 바뀐 것이 빠짐없이 들어온다.
 * - 지지난주 금요일보다 앞선 날짜가 없으면(목록이 그 주 안에서 시작하면) 가장 오래된 날짜.
 * - 같은 곳인데 두 금요일 사이에 생긴 폴더가 없으면 **같은 날짜끼리** 고른다 — 비교 화면이 그대로
 *   "바뀐 파일이 없습니다" 를 보여준다. 버튼이 잠기면 "왜 안 되지" 로 읽히므로 이 편이 낫다.
 * - 지난주 금요일 이전 날짜 폴더가 아예 없거나 날짜로 읽히는 폴더가 없으면 null.
 *
 * 같은 곳이면 한 목록에서 둘을 고르므로 `이전` 은 늘 `이후` 보다 오래됐다 (`normalizeSelection` 규칙).
 * 환경이 다르면 각 환경에서 같은 기준으로 고른다.
 */
export function lastWeekSelection(
  leftSnapshots: readonly Snapshot[],
  rightSnapshots: readonly Snapshot[],
  sameSource: boolean,
  range: WeekRange
): Selection | null {
  const ri = rightSnapshots.findIndex((s) => s.sortKey !== '' && s.sortKey <= range.to)
  if (ri < 0) return null
  const right = rightSnapshots[ri]

  // 같은 곳이면 `이후` 자신도 후보다 — 그 주에 새 폴더가 없으면 자기 자신이 지지난주 금요일 시점이다
  const candidates = (sameSource ? leftSnapshots.slice(ri) : leftSnapshots).filter((s) => s.sortKey !== '')
  const left = candidates.find((s) => s.sortKey <= range.from) ?? candidates.at(-1)
  return left ? { left: left.id, right: right.id } : null
}

/**
 * 사람이 날짜를 **어떻게** 골랐나 — 환경(위치)을 바꿔 목록을 새로 읽을 때 다시 적용한다.
 *
 * - `auto` — 고른 적 없음. 기본값(같은 환경이면 최근 변경, 다르면 양쪽 최신)을 쓴다.
 * - `manual` — 칸에 입력했거나 목록에서 골랐다. 그 두 날짜를 기억한다.
 * - `lastWeek` — 지난주 버튼. 날짜가 아니라 "지난주" 를 기억한다 — 환경마다 그 주의 날짜 폴더가 다르다.
 */
export type DateIntent = { kind: 'auto' } | { kind: 'manual'; selection: Selection } | { kind: 'lastWeek' }

export const AUTO_INTENT: DateIntent = { kind: 'auto' }

/**
 * 새 목록에서 의도를 다시 살린다. 살릴 수 없으면 null — 호출부가 기본값으로 간다.
 *
 * 직접 고른 날짜는 **두 날짜가 그대로 다 있을 때만** 살린다. 한쪽만 맞추면 사람이 고른 것도
 * 기본값도 아닌 어중간한 쌍이 된다. 지난주는 새 목록으로 다시 계산한다.
 */
export function selectionFromIntent(
  intent: DateIntent,
  leftSnapshots: readonly Snapshot[],
  rightSnapshots: readonly Snapshot[],
  sameSource: boolean,
  range: WeekRange
): Selection | null {
  if (intent.kind === 'auto') return null
  const want =
    intent.kind === 'lastWeek'
      ? lastWeekSelection(leftSnapshots, rightSnapshots, sameSource, range)
      : intent.selection
  if (!want) return null
  // 같은 날짜끼리는 지난주(변경 없음)에서만 나온다
  const fixed = normalizeSelection(want, leftSnapshots, rightSnapshots, sameSource, intent.kind === 'lastWeek')
  return fixed.left === want.left && fixed.right === want.right ? fixed : null
}

/**
 * 직접 타이핑한 문자열을 스냅샷 하나로 해석한다. 위에서부터 순서대로 시도한다.
 *
 * 1. 폴더명 완전 일치 (대소문자 무시)
 * 2. **날짜 일치** — 입력을 날짜로 읽어 `sortKey` 와 비교한다.
 *    폴더가 `20260801` 이어도 `2026-08-01` 로 쳐서 찾을 수 있다.
 * 3. 부분 일치 — 후보가 **딱 하나일 때만** 인정한다.
 *
 * 어느 것도 아니거나 후보가 여럿이면 null. 호출부는 입력을 되돌린다.
 */
export function resolveSnapshotInput(
  choices: readonly Snapshot[],
  raw: string
): Snapshot | null {
  const query = raw.trim()
  if (!query) return null

  const lower = query.toLowerCase()

  const exact = choices.find((s) => s.id.toLowerCase() === lower)
  if (exact) return exact

  const key = snapshotSortKey(query)
  if (key) {
    const sameDate = choices.filter((s) => s.sortKey === key)
    if (sameDate.length === 1) return sameDate[0]
  }

  const partial = choices.filter((s) => s.id.toLowerCase().includes(lower))
  return partial.length === 1 ? partial[0] : null
}
