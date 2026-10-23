import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_REPORT_KIND,
  parseReportKind,
  primaryKind,
} from '../src/features/report/reportPreference.ts'

/**
 * 보고서 본 버튼이 무엇을 받을지 — 마지막으로 고른 것, 처음은 통합.
 */

test('처음(저장값 없음)은 통합 — 가장 많이 받는 보고서다', () => {
  assert.equal(DEFAULT_REPORT_KIND, 'all')
  assert.equal(parseReportKind(null), 'all')
  assert.equal(parseReportKind(''), 'all')
})

test('고른 것을 그대로 되살린다', () => {
  assert.equal(parseReportKind('code'), 'code')
  assert.equal(parseReportKind('schema'), 'schema')
  assert.equal(parseReportKind('all'), 'all')
})

test('모르는 저장값은 통합으로 — 망가진 값이 엉뚱한 보고서로 둔갑하지 않게', () => {
  assert.equal(parseReportKind('ALL'), 'all')
  assert.equal(parseReportKind('pdf'), 'all')
})

test('스키마 위치가 없으면 본 버튼은 소스로 내려간다 — 영영 못 받는 버튼을 두지 않는다', () => {
  assert.equal(primaryKind('all', false), 'code')
  assert.equal(primaryKind('schema', false), 'code')
  assert.equal(primaryKind('code', false), 'code')
})

test('스키마 위치가 있으면 고른 것 그대로', () => {
  assert.equal(primaryKind('all', true), 'all')
  assert.equal(primaryKind('schema', true), 'schema')
  assert.equal(primaryKind('code', true), 'code')
})
