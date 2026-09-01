import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DIFF_OPTIONS,
  parseDiffOptions,
} from '../src/features/settings/diffOptions.ts'
import { DEFAULT_OPTIONS } from '../src/lib/normalize.ts'

/**
 * 무시 옵션의 **기본값과 저장**만 다룬다 (옵션의 뜻은 diffEngine.test.ts 가 본다).
 * 저장값은 사용자가 직접 고칠 수 있으므로 믿지 않고 한 겹 검증한다.
 */

/* ---------------- 기본값 ---------------- */

test('처음 열면 공백·빈 줄·주석·작성자·죽은 코드가 켜져 있다', () => {
  assert.equal(DEFAULT_DIFF_OPTIONS.ignoreWhitespace, true)
  assert.equal(DEFAULT_DIFF_OPTIONS.ignoreBlankLines, true)
  assert.equal(DEFAULT_DIFF_OPTIONS.ignoreComments, true)
  assert.equal(DEFAULT_DIFF_OPTIONS.ignoreAuthor, true)
  assert.equal(DEFAULT_DIFF_OPTIONS.ignoreDeadCode, true)
})

test('대소문자만 꺼져 있다 — C 에서는 다른 이름이다', () => {
  assert.equal(DEFAULT_DIFF_OPTIONS.ignoreCase, false)
})

test('옵션 항목이 diff 엔진 쪽과 어긋나지 않는다', () => {
  assert.deepEqual(Object.keys(DEFAULT_DIFF_OPTIONS).sort(), Object.keys(DEFAULT_OPTIONS).sort())
})

/* ---------------- 저장값 읽기 ---------------- */

test('저장값이 없으면 기본값', () => {
  assert.deepEqual(parseDiffOptions(null), DEFAULT_DIFF_OPTIONS)
  assert.deepEqual(parseDiffOptions(''), DEFAULT_DIFF_OPTIONS)
})

test('저장된 선택을 그대로 되살린다', () => {
  const saved = JSON.stringify({ ...DEFAULT_DIFF_OPTIONS, ignoreComments: false, ignoreCase: true })
  const parsed = parseDiffOptions(saved)
  assert.equal(parsed.ignoreComments, false)
  assert.equal(parsed.ignoreCase, true)
  assert.equal(parsed.ignoreWhitespace, true)
})

test('나중에 생긴 옵션은 기본값으로 채운다', () => {
  // ignoreAuthor 가 없던 시절의 저장값
  const old = JSON.stringify({
    ignoreWhitespace: false,
    ignoreCase: false,
    ignoreBlankLines: false,
    ignoreComments: false,
  })
  const parsed = parseDiffOptions(old)
  assert.equal(parsed.ignoreWhitespace, false, '적혀 있던 선택은 지킨다')
  assert.equal(parsed.ignoreAuthor, true, '없던 항목은 기본값')
})

test('망가진 값은 항목 단위로만 버린다', () => {
  const parsed = parseDiffOptions(JSON.stringify({ ignoreComments: 'yes', ignoreCase: true }))
  assert.equal(parsed.ignoreComments, true, '불리언이 아니면 기본값')
  assert.equal(parsed.ignoreCase, true, '멀쩡한 항목은 살린다')
})

test('JSON 이 아니거나 객체가 아니면 통째로 기본값', () => {
  assert.deepEqual(parseDiffOptions('{'), DEFAULT_DIFF_OPTIONS)
  assert.deepEqual(parseDiffOptions('null'), DEFAULT_DIFF_OPTIONS)
  assert.deepEqual(parseDiffOptions('"prod"'), DEFAULT_DIFF_OPTIONS)
})
