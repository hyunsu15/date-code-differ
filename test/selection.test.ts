import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_SELECTION,
  leftChoices,
  normalizeSelection,
  resolveSnapshotInput,
  rightChoices,
} from '../src/features/snapshots/selection.ts'
import type { Snapshot } from '../src/types.ts'

/**
 * 좌우 선택 규칙: `이후` 는 `이전` 보다 반드시 최신이다.
 * 목록은 최신순이라 index 가 작을수록 최신이다.
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

/* ---------------- 고를 수 있는 목록 ---------------- */

test('이전 목록에서 가장 최신은 빠진다 — 그보다 뒤(이후)가 없다', () => {
  assert.deepEqual(ids(leftChoices(LIST)), ['2026-08-01', '2026-07-01', '2026-06-01'])
})

test('이후 목록은 고른 이전보다 최신인 것만 나온다', () => {
  assert.deepEqual(ids(rightChoices(LIST, '2026-06-01')), [
    '2026-09-01',
    '2026-08-01',
    '2026-07-01',
  ])
  assert.deepEqual(ids(rightChoices(LIST, '2026-08-01')), ['2026-09-01'])
})

test('이후 목록에는 이전과 같은 날짜도 나오지 않는다', () => {
  for (const left of ids(LIST)) {
    assert.ok(!ids(rightChoices(LIST, left)).includes(left), left)
  }
})

test('이전이 가장 최신이면 고를 수 있는 이후가 없다', () => {
  assert.deepEqual(rightChoices(LIST, '2026-09-01'), [])
})

test('목록에 없는 이전이면 이후 후보도 없다', () => {
  assert.deepEqual(rightChoices(LIST, '없는날짜'), [])
})

/* ---------------- 선택 바로잡기 ---------------- */

test('처음 열면 최근 두 개가 잡힌다', () => {
  assert.deepEqual(normalizeSelection(LIST, EMPTY_SELECTION), {
    left: '2026-08-01',
    right: '2026-09-01',
  })
})

test('규칙에 맞는 선택은 건드리지 않는다', () => {
  const want = { left: '2026-06-01', right: '2026-09-01' }
  assert.deepEqual(normalizeSelection(LIST, want), want)
})

test('이전을 이후보다 최신으로 옮기면 이후가 한 칸 더 최신으로 끌려 올라간다', () => {
  // 이전을 07-01 → 09-01 로 옮기면 이후(08-01)가 더 이상 최신이 아니다
  assert.deepEqual(normalizeSelection(LIST, { left: '2026-09-01', right: '2026-08-01' }), {
    left: '2026-08-01', // 가장 최신은 이전이 될 수 없어 한 칸 내려온다
    right: '2026-09-01',
  })
})

test('이전과 이후가 같으면 이후를 한 칸 최신으로 올린다', () => {
  assert.deepEqual(normalizeSelection(LIST, { left: '2026-07-01', right: '2026-07-01' }), {
    left: '2026-07-01',
    right: '2026-08-01',
  })
})

test('이후가 이전보다 오래됐으면 이전 바로 위로 올린다', () => {
  assert.deepEqual(normalizeSelection(LIST, { left: '2026-08-01', right: '2026-06-01' }), {
    left: '2026-08-01',
    right: '2026-09-01',
  })
})

test('목록에 없는 값은 기본 선택으로 되돌린다', () => {
  assert.deepEqual(normalizeSelection(LIST, { left: '삭제됨', right: '삭제됨' }), {
    left: '2026-08-01',
    right: '2026-09-01',
  })
})

test('이전만 살아남으면 이후를 그 위로 붙인다', () => {
  assert.deepEqual(normalizeSelection(LIST, { left: '2026-06-01', right: '삭제됨' }), {
    left: '2026-06-01',
    right: '2026-07-01',
  })
})

test('스냅샷이 2개 미만이면 비교할 수 없어 빈 선택', () => {
  assert.deepEqual(normalizeSelection([], EMPTY_SELECTION), EMPTY_SELECTION)
  assert.deepEqual(normalizeSelection([snap('2026-08-01')], EMPTY_SELECTION), EMPTY_SELECTION)
})

test('스냅샷이 딱 2개면 유일한 조합으로 고정된다', () => {
  const two = [snap('2026-09-01'), snap('2026-08-01')]
  for (const want of [
    EMPTY_SELECTION,
    { left: '2026-09-01', right: '2026-08-01' }, // 뒤집힌 입력
    { left: '2026-08-01', right: '2026-08-01' }, // 같은 값
  ]) {
    assert.deepEqual(normalizeSelection(two, want), {
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
      const got = normalizeSelection(LIST, { left, right })
      const li = ids(LIST).indexOf(got.left)
      const ri = ids(LIST).indexOf(got.right)
      assert.ok(li >= 0 && ri >= 0, `목록 밖 값이 나옴: ${JSON.stringify(got)}`)
      assert.ok(ri < li, `이후가 이전보다 최신이어야 함: ${JSON.stringify(got)}`)
    }
  }
})

test('바로잡은 결과를 다시 넣어도 그대로다 (멱등)', () => {
  for (const left of [...ids(LIST), '없는값']) {
    const once = normalizeSelection(LIST, { left, right: '없는값' })
    assert.deepEqual(normalizeSelection(LIST, once), once)
  }
})

test('바로잡은 결과는 항상 화면 목록 안에서 고를 수 있다', () => {
  for (const left of [...ids(LIST), '없는값']) {
    const sel = normalizeSelection(LIST, { left, right: '없는값' })
    assert.ok(ids(leftChoices(LIST)).includes(sel.left), `이전 목록에 없음: ${sel.left}`)
    assert.ok(
      ids(rightChoices(LIST, sel.left)).includes(sel.right),
      `이후 목록에 없음: ${sel.right}`
    )
  }
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
  const rights = rightChoices(LIST, '2026-08-01') // -> [2026-09-01]
  assert.equal(resolveSnapshotInput(rights, '2026-09-01')?.id, '2026-09-01')
  assert.equal(resolveSnapshotInput(rights, '2026-06-01'), null)
})
