import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  arrangeDates,
  arrangeSets,
  changeHistory,
  countDetail,
  currentSetIndex,
  dayLabel,
  DEFAULT_DATE_PREFS,
  parseDatePrefs,
  shortDate,
} from '../src/features/snapshots/dateList.ts'
import { snapshotSortKey } from '../src/lib/fileTypes.ts'
import type { Snapshot, SnapshotChange } from '../src/types.ts'

/**
 * 날짜 고르기 — **변경 이력**(이전·이후 한 쌍씩)과 **날짜 직접**.
 *
 * 핵심: 이력 한 줄을 고르면 줄에 적힌 숫자가 그대로 화면 결과여야 한다. 그러려면 쌍의 앞쪽이
 * "그 내용이 처음 생긴 배포일" 이어야 하고, 배포 없던 날은 이력에 따로 나오면 안 된다.
 */

const snap = (id: string): Snapshot => ({ id, sortKey: snapshotSortKey(id), fileCount: 1, packageCount: 1 })
const ch = (id: string, base: string | null, added = 0, removed = 0, modified = 0): SnapshotChange => ({
  id,
  base,
  added,
  removed,
  modified,
})

// 최신순(서버 순서). 08-15 · 07-15 · 09-05 는 배포 없던 날(앞 날짜와 똑같음)
const DATES = ['2026-09-05', '2026-09-01', '2026-08-15', '2026-08-01', '2026-07-15', '2026-07-01'].map(snap)
const CHANGES = new Map(
  [
    ch('2026-09-05', '2026-09-01'),
    ch('2026-09-01', '2026-08-15', 2, 3, 4),
    ch('2026-08-15', '2026-08-01'),
    ch('2026-08-01', '2026-07-15', 7, 1, 3),
    ch('2026-07-15', '2026-07-01'),
    ch('2026-07-01', null, 40),
  ].map((c) => [c.id, c])
)
const H = changeHistory(DATES, CHANGES)

/* ---------------- 변경 이력 ---------------- */

test('바뀐 일마다 한 쌍 — 앞쪽은 그 내용이 처음 생긴 배포일, 배포 없던 날은 따로 나오지 않는다', () => {
  assert.deepEqual(H.sets, [
    { from: '2026-08-01', to: '2026-09-01', added: 2, removed: 3, modified: 4 },
    { from: '2026-07-01', to: '2026-08-01', added: 7, removed: 1, modified: 3 },
  ])
})

test('날짜마다 내용이 같은 묶음의 첫 날을 안다 — 배포 없던 날은 앞 배포일을 가리킨다', () => {
  assert.equal(H.runOf.get('2026-09-05'), '2026-09-01')
  assert.equal(H.runOf.get('2026-08-15'), '2026-08-01')
  assert.equal(H.runOf.get('2026-07-15'), '2026-07-01')
  assert.equal(H.runOf.get('2026-08-01'), '2026-08-01')
})

test('지금 고른 비교가 어느 쌍인지 — 같은 묶음 날짜끼리면 같은 쌍이다', () => {
  // 처음 기본값처럼 08-15 → 09-05 를 골라도 내용은 08-01 → 09-01 과 같다
  assert.equal(currentSetIndex(H, '2026-08-15', '2026-09-05'), 0)
  assert.equal(currentSetIndex(H, '2026-07-01', '2026-08-01'), 1)
  // 여러 배포를 건너뛴 비교는 이력 한 줄이 아니다
  assert.equal(currentSetIndex(H, '2026-07-01', '2026-09-01'), -1)
})

test('바뀐 게 하나도 없으면 이력이 비고, 날짜가 아닌 폴더는 이력에서 빠진다', () => {
  const dates = [snap('2026-09-01'), snap('2026-08-01'), snap('latest')]
  const h = changeHistory(dates, new Map([[ '2026-09-01', ch('2026-09-01', '2026-08-01') ], [ '2026-08-01', ch('2026-08-01', 'latest', 0, 0, 0) ]]))
  assert.deepEqual(h.sets, [])
  assert.equal(h.runOf.has('latest'), false)
})

test('이력 순서 — 기본 최신순, 오래된순이면 뒤집는다', () => {
  assert.deepEqual(
    arrangeSets(H.sets, 'asc').map((s) => s.to),
    ['2026-08-01', '2026-09-01']
  )
})

test('추가·삭제·변경 중 0 이 아닌 것만', () => {
  assert.equal(countDetail({ added: 2, removed: 0, modified: 4 }), '추가 2 · 변경 4')
})

/* ---------------- 날짜 직접 ---------------- */

test('날짜 직접은 배포일에만 "이날 N개", 가장 오래된 날은 "처음", 배포 없던 날은 빈칸', () => {
  assert.equal(dayLabel(H, '2026-09-01', '파일'), '이날 파일 9개')
  assert.equal(dayLabel(H, '2026-08-01', '테이블'), '이날 테이블 11개')
  assert.equal(dayLabel(H, '2026-07-01', '파일'), '처음')
  assert.equal(dayLabel(H, '2026-08-15', '파일'), '')
  assert.equal(dayLabel(null, '2026-09-01', '파일'), '', '이력을 모르면 아무것도 붙이지 않는다')
})

test('날짜 직접 순서 — 오래된순은 날짜만 뒤집고 날짜가 아닌 폴더는 늘 맨 아래', () => {
  const withOdd = [snap('2026-09-01'), snap('2026-08-01'), snap('latest')]
  assert.deepEqual(
    arrangeDates(withOdd, 'asc').map((s) => s.id),
    ['2026-08-01', '2026-09-01', 'latest']
  )
  assert.deepEqual(
    arrangeDates(withOdd, 'desc').map((s) => s.id),
    ['2026-09-01', '2026-08-01', 'latest']
  )
})

/* ---------------- 저장값 ---------------- */

test('처음은 변경 이력 · 최신순', () => {
  assert.deepEqual(DEFAULT_DATE_PREFS, { view: 'sets', order: 'desc' })
  assert.deepEqual(parseDatePrefs(null), DEFAULT_DATE_PREFS)
  assert.deepEqual(parseDatePrefs('{'), DEFAULT_DATE_PREFS)
})

test('예전 저장값은 뜻이 같은 보기로 — 전체 날짜를 보던 사람은 날짜 직접', () => {
  assert.deepEqual(parseDatePrefs('{"filter":"all","order":"asc"}'), { view: 'dates', order: 'asc' })
  assert.deepEqual(parseDatePrefs('{"filter":"changed","order":"desc"}'), { view: 'sets', order: 'desc' })
  assert.deepEqual(parseDatePrefs('{"view":"dates","order":"desc"}'), { view: 'dates', order: 'desc' })
})

test('짧은 날짜는 월-일, 날짜로 안 읽히면 그대로', () => {
  assert.equal(shortDate('20260801'), '08-01')
  assert.equal(shortDate('latest'), 'latest')
})
