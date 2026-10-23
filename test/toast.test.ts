import { afterEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { clearToasts, dismissToast, getToasts, pushToast, runToastAction } from '../src/lib/toast.ts'

/**
 * 알림의 버튼(되돌리기 등)은 **한 번만** 돌고 알림을 닫아야 한다.
 * 두 번 돌면 "제외 → 되돌리기" 가 "제외 → 되돌리기 → 다시 제외" 가 된다.
 */

afterEach(() => {
  clearToasts()
  mock.timers.reset()
})

test('버튼을 누르면 한 번 실행하고 알림을 닫는다', () => {
  let runs = 0
  const id = pushToast('info', '내 제외 목록에 넣었습니다 — a.pc', undefined, {
    label: '되돌리기',
    run: () => (runs += 1),
  })
  assert.equal(getToasts()[0]?.action?.label, '되돌리기')

  runToastAction(id)
  assert.equal(runs, 1)
  assert.equal(getToasts().length, 0)

  // 이미 닫힌 알림을 다시 눌러도(두 번 클릭) 더 돌지 않는다
  runToastAction(id)
  assert.equal(runs, 1)
})

test('닫기만 하면 버튼 일은 돌지 않는다', () => {
  let runs = 0
  const id = pushToast('info', '제목', undefined, { label: '되돌리기', run: () => (runs += 1) })
  dismissToast(id)
  runToastAction(id)
  assert.equal(runs, 0)
})

test('버튼이 없는 알림은 눌러도 닫히지 않는다', () => {
  const id = pushToast('error', '읽지 못했습니다', '원문')
  runToastAction(id)
  assert.equal(getToasts().length, 1)
})

test('안내 알림은 버튼이 있어도 6초 뒤 접힌다 — 오류는 남는다', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  pushToast('info', '내 제외 목록에 넣었습니다 — a.pc', undefined, { label: '되돌리기', run: () => {} })
  pushToast('error', '읽지 못했습니다')

  mock.timers.tick(5_999)
  assert.equal(getToasts().length, 2)
  mock.timers.tick(1)
  assert.deepEqual(
    getToasts().map((t) => t.kind),
    ['error']
  )
})
