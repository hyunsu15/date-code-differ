/**
 * 바뀐 것(추가 · 삭제 · 변경)을 **위로**, 동일한 것을 아래로 — 각 묶음 안의 순서(경로·이름순)는 그대로 둔다.
 *
 * "변경된 파일만 / 테이블만" 을 끄고 전체를 볼 때 쓴다. 이름순으로만 두면 바뀐 것이 동일한 것 사이에
 * 흩어져, 전체를 켜는 순간 정작 봐야 할 것을 다시 찾아야 한다. 코드 파일 목록과 스키마 테이블 목록이 같이 쓴다.
 */
export function changedFirst<T extends { status: string }>(items: readonly T[]): T[] {
  const { changed, same } = splitSame(items)
  return [...changed, ...same]
}

/**
 * 바뀐 것과 동일한 것을 **두 묶음으로** — 목록이 바뀐 것은 늘 보이고, 동일한 것은 맨 아래 접힘 줄
 * (`SameFold`) 밑에 둔다. 각 묶음 안의 순서는 그대로다.
 */
export function splitSame<T extends { status: string }>(items: readonly T[]): { changed: T[]; same: T[] } {
  return {
    changed: items.filter((i) => i.status !== 'same'),
    same: items.filter((i) => i.status === 'same'),
  }
}

/**
 * 지금 목록에 **실제로 보이는** 항목들 — 고른 항목 맞추기 · 이전/다음 이동이 이 순서를 따른다.
 * 동일한 것은 펼쳤거나 검색 중일 때만 들어간다.
 */
export function shownItems<T>(changed: readonly T[], same: readonly T[], sameOpen: boolean, searching: boolean): T[] {
  return sameOpen || searching ? [...changed, ...same] : [...changed]
}
