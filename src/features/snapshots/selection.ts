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
  sameSource: boolean
): Selection {
  if (!sameSource) {
    if (leftSnapshots.length === 0 || rightSnapshots.length === 0) return EMPTY_SELECTION
    const pick = (snapshots: readonly Snapshot[], id: string): string =>
      indexOfSnapshot(snapshots, id) >= 0 ? id : snapshots[0].id
    return { left: pick(leftSnapshots, want.left), right: pick(rightSnapshots, want.right) }
  }

  const snapshots = leftSnapshots
  if (snapshots.length < 2) return EMPTY_SELECTION

  const wantedLeft = indexOfSnapshot(snapshots, want.left)
  const li = wantedLeft < 1 ? 1 : wantedLeft

  const wantedRight = indexOfSnapshot(snapshots, want.right)
  const ri = wantedRight < 0 || wantedRight >= li ? li - 1 : wantedRight

  return { left: snapshots[li].id, right: snapshots[ri].id }
}

/** 일주일 프리셋이 거슬러 가는 날 수 */
export const WEEK_DAYS = 7

/** `YYYYMMDD` 에서 며칠 앞의 `YYYYMMDD` — 달·해 넘김은 Date 가 맡는다 (시간대 영향이 없게 UTC 로 센다) */
export function daysBefore(sortKey: string, days: number): string {
  const at = Date.UTC(Number(sortKey.slice(0, 4)), Number(sortKey.slice(4, 6)) - 1, Number(sortKey.slice(6, 8)))
  return new Date(at - days * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * **일주일 프리셋** — `이후` 는 대상 쪽 최신 날짜, `이전` 은 그 7일 전 시점의 모습.
 *
 * - 7일 전 날짜 폴더가 없으면 **그보다 앞의 가장 가까운 날짜**를 쓴다 — 배포가 없던 날은 폴더도 없으니,
 *   그날 깔려 있던 것은 바로 앞 배포본이다. 그래야 "이번 주에 바뀐 것" 이 빠짐없이 들어온다.
 * - 7일을 거슬러 갈 날짜가 없으면(목록이 일주일보다 짧으면) 가장 오래된 날짜.
 * - 날짜를 못 읽는 폴더는 고르지 않는다. 고를 것이 없으면 null.
 *
 * 같은 곳이면 한 목록에서 둘을 고르므로 `이전` 은 늘 `이후` 보다 오래됐다 (`normalizeSelection` 규칙).
 * 환경이 다르면 `이후` 는 대상 환경 최신, `이전` 은 기준 환경에서 같은 기준으로 고른다.
 */
export function weekAgoSelection(
  leftSnapshots: readonly Snapshot[],
  rightSnapshots: readonly Snapshot[],
  sameSource: boolean
): Selection | null {
  const ri = rightSnapshots.findIndex((s) => s.sortKey !== '')
  if (ri < 0) return null
  const right = rightSnapshots[ri]

  const candidates = (sameSource ? leftSnapshots.slice(ri + 1) : leftSnapshots).filter((s) => s.sortKey !== '')
  if (candidates.length === 0) return null

  const target = daysBefore(right.sortKey, WEEK_DAYS)
  const left = candidates.find((s) => s.sortKey <= target) ?? candidates[candidates.length - 1]
  return { left: left.id, right: right.id }
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
