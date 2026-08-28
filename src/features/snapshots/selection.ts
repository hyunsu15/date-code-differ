import { snapshotSortKey } from '../../lib/fileTypes.ts'
import type { Snapshot } from '../../types.ts'

/** 비교할 좌우 스냅샷 한 쌍 */
export interface Selection {
  /** 이전 (기준이 되는 예전 날짜) */
  left: string
  /** 이후 (비교 대상이 되는 최근 날짜) — 항상 left 보다 최신이다 */
  right: string
}

export const EMPTY_SELECTION: Selection = { left: '', right: '' }

/**
 * 스냅샷 목록은 **최신순**이므로 index 가 작을수록 최신이다.
 * 이 프로젝트의 좌우 규칙은 하나뿐이다 — `이후` 는 `이전` 보다 반드시 최신이다.
 */
export const indexOfSnapshot = (snapshots: readonly Snapshot[], id: string): number =>
  snapshots.findIndex((s) => s.id === id)

/** `이전` 으로 고를 수 있는 목록 — 가장 최신은 그보다 뒤(이후)가 없어 제외한다 */
export const leftChoices = (snapshots: readonly Snapshot[]): Snapshot[] => snapshots.slice(1)

/** `이후` 로 고를 수 있는 목록 — 고른 `이전` 보다 최신인 것만 */
export function rightChoices(snapshots: readonly Snapshot[], left: string): Snapshot[] {
  const li = indexOfSnapshot(snapshots, left)
  return li < 0 ? [] : snapshots.slice(0, li)
}

/**
 * 원하는 선택을 규칙에 맞게 바로잡는다.
 * 목록이 바뀌었거나 `이전` 을 옮겨 `이후` 가 더 이상 최신이 아니게 된 경우를 여기서 흡수한다.
 *
 * - 스냅샷이 2개 미만이면 비교 자체가 불가능하므로 빈 선택을 돌려준다.
 * - `이전` 이 목록에 없거나 가장 최신이면 두 번째로 최신인 것으로 옮긴다.
 * - `이후` 가 목록에 없거나 `이전` 보다 오래됐으면 `이전` 바로 위(한 칸 더 최신)로 옮긴다.
 */
export function normalizeSelection(snapshots: readonly Snapshot[], want: Selection): Selection {
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
