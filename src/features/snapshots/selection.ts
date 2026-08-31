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
