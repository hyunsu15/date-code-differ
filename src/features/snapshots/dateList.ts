import { snapshotSortKey } from '../../lib/fileTypes.ts'
import type { Snapshot, SnapshotChange } from '../../types.ts'

/**
 * 날짜 고르기 목록 — **변경 이력**(이전·이후 한 쌍씩)과 **날짜 직접**(한쪽씩) 두 가지 보기.
 *
 * 비교는 이전·이후 두 날짜의 쌍인데, 예전 목록은 날짜 하나에 "N개 바뀜" 을 붙였다. 그러면 목록에서 본
 * 숫자(그 날짜 vs 바로 앞 날짜)와 고른 뒤 화면 결과(이전 vs 이후)가 어긋났다. 그래서 **바뀐 일 하나 =
 * 이전·이후 한 쌍**으로 보여준다 — git 커밋 목록·배포 이력과 같은 모양이다. 줄의 숫자가 곧 고른 뒤 결과다.
 *
 * 배포가 없던 날(앞 날짜와 똑같은 폴더)은 앞 배포일과 내용이 같으므로 이력에 따로 나오지 않는다.
 * 쌍의 앞쪽은 **그 내용이 처음 생긴 배포일**로 잡는다(08-15 가 08-01 과 같으면 `08-01 → 09-01`).
 */

export type DateView = 'sets' | 'dates'
export type DateOrder = 'desc' | 'asc'

export interface DateListPrefs {
  /** 변경 이력(쌍) / 날짜 직접(한쪽씩) */
  view: DateView
  order: DateOrder
}

/** 처음은 **변경 이력 · 최신순** */
export const DEFAULT_DATE_PREFS: DateListPrefs = { view: 'sets', order: 'desc' }

const STORAGE_KEY = 'cd-date-list'

/**
 * 모르는 값은 기본으로 — 망가진 저장값이 목록을 비우지 않게.
 * 예전 저장값(`filter: 'changed' | 'all'`)은 뜻이 같은 보기로 옮긴다 — 전체 날짜를 보던 사람은 날짜 직접.
 */
export function parseDatePrefs(raw: string | null): DateListPrefs {
  if (!raw) return { ...DEFAULT_DATE_PREFS }
  try {
    const v = JSON.parse(raw) as Partial<Record<string, unknown>>
    const view: DateView = v.view === 'dates' || v.filter === 'all' ? 'dates' : 'sets'
    return { view, order: v.order === 'asc' ? 'asc' : 'desc' }
  } catch {
    return { ...DEFAULT_DATE_PREFS }
  }
}

export function loadDatePrefs(): DateListPrefs {
  try {
    return parseDatePrefs(localStorage.getItem(STORAGE_KEY))
  } catch {
    return { ...DEFAULT_DATE_PREFS }
  }
}

export function saveDatePrefs(prefs: DateListPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}

/** 바뀐 수 합 */
export const changeTotal = (c: { added: number; removed: number; modified: number }): number =>
  c.added + c.removed + c.modified

/** 바뀐 일 하나 — 이 쌍을 고르면 줄에 적힌 숫자 그대로가 화면에 나온다 */
export interface ChangeSet {
  /** 이전 — 그 내용이 처음 생긴 배포일 */
  from: string
  /** 이후 — 바뀐 날 */
  to: string
  added: number
  removed: number
  modified: number
}

export interface ChangeHistory {
  /** 최신순 */
  sets: ChangeSet[]
  /** 날짜 → 그 날짜와 내용이 같은 묶음의 첫 날(배포일). 배포 없던 날은 앞 배포일을 가리킨다 */
  runOf: ReadonlyMap<string, string>
}

/**
 * 날짜별 변경 수(각 날짜 vs 바로 앞 날짜)를 **변경 이력**으로 편다.
 *
 * 오래된 날짜부터 훑으며 "내용이 같은 날짜 묶음" 을 이어 간다. 앞 날짜와 같으면 같은 묶음, 다르면
 * 새 묶음이 시작되고 (앞 묶음의 첫 날 → 이 날) 한 쌍이 생긴다. 날짜로 읽히지 않는 폴더는 순서를 알 수
 * 없어 이력에서 뺀다(날짜 직접에서는 고를 수 있다). 변경 수를 모르는 날짜는 바뀐 것으로 보지 않는다.
 *
 * @param snapshots 한 위치의 날짜 목록 (서버 순서 — 최신순)
 */
export function changeHistory(
  snapshots: readonly Snapshot[],
  changes: ReadonlyMap<string, SnapshotChange>
): ChangeHistory {
  const oldestFirst = snapshots.filter((s) => s.sortKey).reverse()
  const runOf = new Map<string, string>()
  const sets: ChangeSet[] = []

  let runStart: string | null = null
  for (const s of oldestFirst) {
    const c = changes.get(s.id)
    if (runStart === null) {
      runStart = s.id
    } else if (c && c.base !== null && changeTotal(c) > 0) {
      sets.push({ from: runStart, to: s.id, added: c.added, removed: c.removed, modified: c.modified })
      runStart = s.id
    }
    runOf.set(s.id, runStart)
  }

  return { sets: sets.reverse(), runOf }
}

/** 지금 고른 이전·이후가 어느 변경 쌍과 같은 비교인가 — 같은 묶음의 날짜면 같다. 없으면 -1 */
export function currentSetIndex(history: ChangeHistory, left: string, right: string): number {
  const l = history.runOf.get(left)
  const r = history.runOf.get(right)
  return history.sets.findIndex((s) => s.from === l && s.to === r)
}

/** 순서만 바꾼다 — 오래된순은 날짜로 읽히는 것만 뒤집고, 날짜가 아닌 폴더는 늘 맨 아래에 둔다 */
export function arrangeDates(choices: readonly Snapshot[], order: DateOrder): Snapshot[] {
  if (order === 'desc') return [...choices]
  const dated = choices.filter((s) => s.sortKey)
  const others = choices.filter((s) => !s.sortKey)
  return [...dated.reverse(), ...others]
}

/** 변경 이력 순서 — 기본 최신순, 오래된순이면 뒤집는다 */
export const arrangeSets = (sets: readonly ChangeSet[], order: DateOrder): ChangeSet[] =>
  order === 'desc' ? [...sets] : [...sets].reverse()

/**
 * 날짜 이름을 짧게 — "08-01" 처럼. 날짜로 안 읽히면 그대로.
 * 이름에서 바로 뽑는다 — 견준 앞 날짜가 지금 칸의 후보에 없을 수도 있어서(오른쪽 칸 등).
 */
export function shortDate(id: string): string {
  const key = snapshotSortKey(id)
  return key ? `${key.slice(4, 6)}-${key.slice(6, 8)}` : id
}

/**
 * 무엇을 셌나 — 코드 탭은 파일, 스키마 탭은 테이블. 두 탭이 같은 목록을 쓰므로 숫자 앞에 적어 가른다.
 */
export type ChangeUnit = '파일' | '테이블'

/** 추가 · 삭제 · 변경 중 0 이 아닌 것만 — `추가 2 · 삭제 3 · 변경 4` */
export function countDetail(c: { added: number; removed: number; modified: number }): string {
  return [
    c.added > 0 ? `추가 ${c.added}` : '',
    c.removed > 0 ? `삭제 ${c.removed}` : '',
    c.modified > 0 ? `변경 ${c.modified}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * 날짜 직접 보기에서 날짜 하나에 흐리게 붙일 말 — **배포일만** 표시한다.
 *   배포일        `이날 파일 9개`   (바로 앞 날짜 대비 — 그날 들어온 변경)
 *   가장 오래된 날 `처음`
 *   배포 없던 날   ''               (앞 배포일과 같다 — 아무것도 붙이지 않는다)
 * 숫자가 "이걸 고르면 생길 차이" 로 읽히지 않게 `이날` 을 붙이고 흐리게 둔다.
 */
export function dayLabel(history: ChangeHistory | null, id: string, unit: ChangeUnit): string {
  if (!history) return ''
  const set = history.sets.find((s) => s.to === id)
  if (set) return `이날 ${unit} ${changeTotal(set)}개`
  const first = history.runOf.get(id) === id && !history.sets.some((s) => s.to === id)
  return first ? '처음' : ''
}
