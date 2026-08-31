import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_SELECTION,
  leftChoices,
  normalizeSelection,
  resolveSnapshotInput,
  rightChoices,
} from '../src/features/snapshots/selection.ts'
import type { Selection } from '../src/features/snapshots/selection.ts'
import type { Snapshot } from '../src/types.ts'

/**
 * 좌우 선택 규칙: **좌우가 같은 곳을 볼 때** `이후` 는 `이전` 보다 반드시 최신이다.
 * 목록은 최신순이라 index 가 작을수록 최신이다.
 *
 * 환경이 갈리면(운영 ↔ 테스트) 그 규칙이 없다 — 파일 아래쪽에 따로 모아 뒀다.
 */

const snap = (id: string): Snapshot => ({
  id,
  sortKey: id.replace(/\D/g, '').slice(0, 8),
  fileCount: 1,
  packageCount: 1,
})

/** 최신 → 오래된 순 */
const LIST = ['2026-09-01', '2026-08-01', '2026-07-01', '2026-06-01'].map(snap)

const ids = (list: readonly Snapshot[]): string[] => list.map((s) => s.id)

/** 같은 곳의 두 날짜를 고르는 경우 — 아래 대부분의 테스트가 이 경우다 */
const fix = (snapshots: readonly Snapshot[], want: Selection): Selection =>
  normalizeSelection(want, snapshots, snapshots, true)

/* ---------------- 고를 수 있는 목록 ---------------- */

test('이전 목록에서 가장 최신은 빠진다 — 그보다 뒤(이후)가 없다', () => {
  assert.deepEqual(ids(leftChoices(LIST, true)), ['2026-08-01', '2026-07-01', '2026-06-01'])
})

test('이후 목록은 고른 이전보다 최신인 것만 나온다', () => {
  assert.deepEqual(ids(rightChoices(LIST, '2026-06-01', true)), [
    '2026-09-01',
    '2026-08-01',
    '2026-07-01',
  ])
  assert.deepEqual(ids(rightChoices(LIST, '2026-08-01', true)), ['2026-09-01'])
})

test('이후 목록에는 이전과 같은 날짜도 나오지 않는다', () => {
  for (const left of ids(LIST)) {
    assert.ok(!ids(rightChoices(LIST, left, true)).includes(left), left)
  }
})

test('이전이 가장 최신이면 고를 수 있는 이후가 없다', () => {
  assert.deepEqual(rightChoices(LIST, '2026-09-01', true), [])
})

test('목록에 없는 이전이면 이후 후보도 없다', () => {
  assert.deepEqual(rightChoices(LIST, '없는날짜', true), [])
})

/* ---------------- 선택 바로잡기 ---------------- */

test('처음 열면 최근 두 개가 잡힌다', () => {
  assert.deepEqual(fix(LIST, EMPTY_SELECTION), {
    left: '2026-08-01',
    right: '2026-09-01',
  })
})

test('규칙에 맞는 선택은 건드리지 않는다', () => {
  const want = { left: '2026-06-01', right: '2026-09-01' }
  assert.deepEqual(fix(LIST, want), want)
})

test('이전을 이후보다 최신으로 옮기면 이후가 한 칸 더 최신으로 끌려 올라간다', () => {
  // 이전을 07-01 → 09-01 로 옮기면 이후(08-01)가 더 이상 최신이 아니다
  assert.deepEqual(fix(LIST, { left: '2026-09-01', right: '2026-08-01' }), {
    left: '2026-08-01', // 가장 최신은 이전이 될 수 없어 한 칸 내려온다
    right: '2026-09-01',
  })
})

test('이전과 이후가 같으면 이후를 한 칸 최신으로 올린다', () => {
  assert.deepEqual(fix(LIST, { left: '2026-07-01', right: '2026-07-01' }), {
    left: '2026-07-01',
    right: '2026-08-01',
  })
})

test('이후가 이전보다 오래됐으면 이전 바로 위로 올린다', () => {
  assert.deepEqual(fix(LIST, { left: '2026-08-01', right: '2026-06-01' }), {
    left: '2026-08-01',
    right: '2026-09-01',
  })
})

test('목록에 없는 값은 기본 선택으로 되돌린다', () => {
  assert.deepEqual(fix(LIST, { left: '삭제됨', right: '삭제됨' }), {
    left: '2026-08-01',
    right: '2026-09-01',
  })
})

test('이전만 살아남으면 이후를 그 위로 붙인다', () => {
  assert.deepEqual(fix(LIST, { left: '2026-06-01', right: '삭제됨' }), {
    left: '2026-06-01',
    right: '2026-07-01',
  })
})

test('스냅샷이 2개 미만이면 비교할 수 없어 빈 선택', () => {
  assert.deepEqual(fix([], EMPTY_SELECTION), EMPTY_SELECTION)
  assert.deepEqual(fix([snap('2026-08-01')], EMPTY_SELECTION), EMPTY_SELECTION)
})

test('스냅샷이 딱 2개면 유일한 조합으로 고정된다', () => {
  const two = [snap('2026-09-01'), snap('2026-08-01')]
  for (const want of [
    EMPTY_SELECTION,
    { left: '2026-09-01', right: '2026-08-01' }, // 뒤집힌 입력
    { left: '2026-08-01', right: '2026-08-01' }, // 같은 값
  ]) {
    assert.deepEqual(fix(two, want), {
      left: '2026-08-01',
      right: '2026-09-01',
    })
  }
})

/* ---------------- 불변식 ---------------- */

test('어떤 입력을 넣어도 결과는 항상 규칙을 만족한다', () => {
  const candidates = [...ids(LIST), '없는값', '']
  for (const left of candidates) {
    for (const right of candidates) {
      const got = fix(LIST, { left, right })
      const li = ids(LIST).indexOf(got.left)
      const ri = ids(LIST).indexOf(got.right)
      assert.ok(li >= 0 && ri >= 0, `목록 밖 값이 나옴: ${JSON.stringify(got)}`)
      assert.ok(ri < li, `이후가 이전보다 최신이어야 함: ${JSON.stringify(got)}`)
    }
  }
})

test('바로잡은 결과를 다시 넣어도 그대로다 (멱등)', () => {
  for (const left of [...ids(LIST), '없는값']) {
    const once = fix(LIST, { left, right: '없는값' })
    assert.deepEqual(fix(LIST, once), once)
  }
})

test('바로잡은 결과는 항상 화면 목록 안에서 고를 수 있다', () => {
  for (const left of [...ids(LIST), '없는값']) {
    const sel = fix(LIST, { left, right: '없는값' })
    assert.ok(ids(leftChoices(LIST, true)).includes(sel.left), `이전 목록에 없음: ${sel.left}`)
    assert.ok(
      ids(rightChoices(LIST, sel.left, true)).includes(sel.right),
      `이후 목록에 없음: ${sel.right}`
    )
  }
})

/* ---------------- 좌우가 서로 다른 곳 (운영 ↔ 테스트) ---------------- */

/** 테스트 환경은 운영보다 뒤처져 있을 수 있다 — 날짜가 겹치지 않는 것이 오히려 흔하다 */
const OTHER = ['2026-08-15', '2026-07-15'].map(snap)

test('환경이 다르면 이전 목록에서 최신을 빼지 않는다', () => {
  assert.deepEqual(ids(leftChoices(LIST, false)), ids(LIST))
})

test('환경이 다르면 이후 목록은 그쪽 전부다 — 순서 규칙이 없다', () => {
  assert.deepEqual(ids(rightChoices(OTHER, '2026-06-01', false)), ids(OTHER))
  // 왼쪽이 그쪽 목록에 아예 없는 날짜여도 후보가 사라지지 않는다
  assert.deepEqual(ids(rightChoices(OTHER, '없는날짜', false)), ids(OTHER))
})

test('환경이 다르면 각자 자기 목록의 최신이 기본이다', () => {
  assert.deepEqual(normalizeSelection(EMPTY_SELECTION, LIST, OTHER, false), {
    left: '2026-09-01',
    right: '2026-08-15',
  })
})

test('오른쪽이 왼쪽보다 오래돼도 그대로 둔다 — 뒤처진 환경을 보는 정상적인 비교다', () => {
  const want = { left: '2026-09-01', right: '2026-07-15' }
  assert.deepEqual(normalizeSelection(want, LIST, OTHER, false), want)
})

test('날짜가 같아도 그대로 둔다 — 위치가 다르면 같은 날짜끼리가 오히려 흔한 질문이다', () => {
  const both = ['2026-08-01'].map(snap)
  const want = { left: '2026-08-01', right: '2026-08-01' }
  assert.deepEqual(normalizeSelection(want, LIST, both, false), want)
})

test('자기 목록에 없는 값만 그쪽 최신으로 되돌린다', () => {
  assert.deepEqual(normalizeSelection({ left: '삭제됨', right: '2026-07-15' }, LIST, OTHER, false), {
    left: '2026-09-01',
    right: '2026-07-15',
  })
})

test('한쪽 목록이 비면 비교할 것이 없다', () => {
  assert.deepEqual(normalizeSelection(EMPTY_SELECTION, LIST, [], false), EMPTY_SELECTION)
  assert.deepEqual(normalizeSelection(EMPTY_SELECTION, [], OTHER, false), EMPTY_SELECTION)
})

test('환경이 다르면 날짜가 하나뿐인 쪽도 비교할 수 있다', () => {
  // 같은 곳이면 2개가 있어야 하지만, 다른 곳과는 하나씩만 있어도 견줄 수 있다
  const one = [snap('2026-08-15')]
  assert.deepEqual(normalizeSelection(EMPTY_SELECTION, one, one, false), {
    left: '2026-08-15',
    right: '2026-08-15',
  })
  assert.deepEqual(fix(one, EMPTY_SELECTION), EMPTY_SELECTION)
})

/* ---------------- 직접 타이핑한 값 해석 ---------------- */

test('폴더명을 그대로 치면 찾는다 (대소문자 무시)', () => {
  assert.equal(resolveSnapshotInput(LIST, '2026-08-01')?.id, '2026-08-01')
  assert.equal(resolveSnapshotInput(LIST, '  2026-08-01  ')?.id, '2026-08-01')

  const mixed = [snap('REL_20260801'), snap('20260701')]
  assert.equal(resolveSnapshotInput(mixed, 'rel_20260801')?.id, 'REL_20260801')
})

test('표기법이 달라도 같은 날짜면 찾는다', () => {
  const compact = [snap('20260901'), snap('20260801'), snap('20260701')]
  // 폴더는 구분자 없이 저장돼 있어도 하이픈으로 쳐서 찾을 수 있다
  assert.equal(resolveSnapshotInput(compact, '2026-08-01')?.id, '20260801')
  assert.equal(resolveSnapshotInput(compact, '2026.08.01')?.id, '20260801')
  // 반대 방향도 된다
  assert.equal(resolveSnapshotInput(LIST, '20260801')?.id, '2026-08-01')
})

test('일부만 쳐도 후보가 하나면 찾는다', () => {
  assert.equal(resolveSnapshotInput(LIST, '08-01')?.id, '2026-08-01')
  assert.equal(resolveSnapshotInput(LIST, '06')?.id, '2026-06-01')
})

test('후보가 여럿이면 해석하지 않는다 — 잘못 고르는 것보다 낫다', () => {
  assert.equal(resolveSnapshotInput(LIST, '2026'), null) // 4개 모두 해당
  assert.equal(resolveSnapshotInput(LIST, '-01'), null)

  const dup = [snap('rel_20260801'), snap('hotfix_20260801')]
  assert.equal(resolveSnapshotInput(dup, '2026-08-01'), null) // 같은 날짜가 둘
})

test('완전 일치는 부분 일치보다 우선한다', () => {
  const tricky = [snap('20260801'), snap('20260801_v2')]
  // `20260801` 은 두 항목 모두의 부분 문자열이지만 완전 일치가 있으므로 그쪽을 쓴다
  assert.equal(resolveSnapshotInput(tricky, '20260801')?.id, '20260801')
})

test('해석할 수 없는 입력은 null', () => {
  for (const raw of ['', '   ', '없는날짜', '2026-99-99', 'zzz']) {
    assert.equal(resolveSnapshotInput(LIST, raw), null, JSON.stringify(raw))
  }
})

test('고를 수 있는 목록 밖은 해석되지 않는다', () => {
  // 이후 후보(= 이전보다 최신)만 넘기면, 규칙을 어기는 날짜는 쳐도 안 잡힌다
  const rights = rightChoices(LIST, '2026-08-01', true) // -> [2026-09-01]
  assert.equal(resolveSnapshotInput(rights, '2026-09-01')?.id, '2026-09-01')
  assert.equal(resolveSnapshotInput(rights, '2026-06-01'), null)
})
