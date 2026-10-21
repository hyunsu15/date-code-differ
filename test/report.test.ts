import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReport, reportFileName, type ReportInput } from '../src/features/report/report.ts'
import type {
  ComparedFile,
  DiffStats,
  FileStatus,
  SchemaKind,
  SchemaSection,
  TableDiff,
} from '../src/types.ts'

/**
 * 사내 공지에 붙일 md 보고서.
 *
 * 숫자가 화면과 어긋나거나 표가 깨지면 공지가 틀린 채로 퍼진다 —
 * 그래서 문자열 모양보다 **표 줄에 무엇이 실리는지**를 본다.
 */

const STATS: DiffStats = {
  aLines: 0,
  bLines: 0,
  comparedA: 0,
  comparedB: 0,
  same: 0,
  modified: 0,
  added: 0,
  removed: 0,
  ignored: 0,
  changedLines: 0,
  charsA: 0,
  charsB: 0,
  commonChars: 0,
  lineSimilarity: 1,
  diceSimilarity: 1,
  charSimilarity: 1,
  changeRatio: 0,
}

const file = (path: string, status: FileStatus, stats: Partial<DiffStats> = {}): ComparedFile => ({
  path,
  name: path.split('/').pop() ?? path,
  packageName: path.split('/')[0],
  status,
  stats: { ...STATS, ...stats },
  leftSize: status === 'added' ? null : 100,
  rightSize: status === 'removed' ? null : 100,
  excluded: false,
  excludedBy: null,
})

const section = (kind: SchemaKind, counts: Partial<SchemaSection> = {}): SchemaSection => ({
  kind,
  rows: [],
  added: 0,
  removed: 0,
  modified: 0,
  total: 0,
  systemHidden: 0,
  excludedHidden: 0,
  excludedChanged: 0,
  ...counts,
})

const table = (
  name: string,
  status: FileStatus,
  counts: Partial<Record<SchemaKind, Partial<SchemaSection>>> = {},
  primaryKeyChanged = false
): TableDiff => ({
  name,
  status,
  sections: {
    column: section('column', counts.column),
    constraint: section('constraint', counts.constraint),
    index: section('index', counts.index),
  },
  primaryKeyChanged,
  changedKinds: [],
})

const CROSS = {
  left: { env: '운영', date: '2026-09-01' },
  right: { env: '테스트', date: '2026-09-01' },
}

const FILES = [
  file('pay/pay_proc.pc', 'modified', { added: 6, removed: 2, modified: 3 }),
  file('cmm/cmm_log.h', 'removed', { aLines: 14 }),
  file('rpt/rpt_daily.pc', 'added', { bLines: 62 }),
  file('ord/ord_main.pc', 'same'),
]

const TABLES = [
  table('TB_ORD', 'modified', { column: { modified: 1, added: 1, removed: 1 }, constraint: { modified: 1 } }, true),
  table('TB_RPT_DAILY', 'added', { column: { added: 8 } }),
  table('TB_CUST', 'same'),
]

const full: ReportInput = {
  code: { ...CROSS, items: FILES },
  schema: { ...CROSS, items: TABLES },
}

/** md 표 한 줄을 칸으로 */
const rowsOf = (md: string): string[][] =>
  md
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| ----') && !/^\| (환경|상태) \|/.test(l))
    .map((l) => l.slice(2, -2).split(' | '))

/* ---------------- 맨 위 요약 표 ---------------- */

test('맨 위 표에 환경·종류·변경 건수·날짜가 실린다 — 동일은 세지 않는다', () => {
  const rows = rowsOf(buildReport(full))
  assert.deepEqual(rows[0], ['운영 → 테스트', '소스', '3건', '2026-09-01'])
  assert.deepEqual(rows[1], ['운영 → 테스트', '스키마', '2건', '2026-09-01'])
})

test('제목에 견준 두 환경이 들어간다', () => {
  assert.match(buildReport(full), /^# 소스 비교 보고서 \(운영 ↔ 테스트\)\n/)
})

test('같은 환경·다른 날짜면 환경은 한 번, 날짜는 화살표로 적는다', () => {
  const md = buildReport({
    code: {
      left: { env: '운영', date: '2026-08-01' },
      right: { env: '운영', date: '2026-09-01' },
      items: FILES,
    },
    schema: null,
  })
  assert.match(md, /^# 소스 비교 보고서 \(운영\)\n/)
  assert.deepEqual(rowsOf(md)[0], ['운영', '소스', '3건', '2026-08-01 → 2026-09-01'])
})

test('환경 설정이 없으면 환경 칸은 — 이고 제목에 괄호가 없다', () => {
  const md = buildReport({
    code: { left: { env: '', date: '0801' }, right: { env: '', date: '0901' }, items: FILES },
    schema: null,
  })
  assert.match(md, /^# 소스 비교 보고서\n/)
  assert.equal(rowsOf(md)[0][0], '—')
})

test('스키마를 안 쓰면 요약 표에 스키마 줄도, 스키마 절도 없다', () => {
  const md = buildReport({ code: full.code, schema: null })
  assert.ok(!md.includes('스키마'))
})

/* ---------------- 변경 내역 ---------------- */

test('소스 목록은 신규 → 삭제 → 수정 순이고 동일 파일은 빠진다', () => {
  const md = buildReport({ code: full.code, schema: null })
  const rows = rowsOf(md).slice(1)
  assert.deepEqual(
    rows.map((r) => [r[0], r[1]]),
    [
      ['신규', 'rpt/rpt_daily.pc'],
      ['삭제', 'cmm/cmm_log.h'],
      ['수정', 'pay/pay_proc.pc'],
    ]
  )
})

test('신규·삭제는 전체 줄 수, 수정은 0 이 아닌 증감만 적는다', () => {
  const rows = rowsOf(buildReport({ code: full.code, schema: null })).slice(1)
  assert.equal(rows[0][2], '+62줄')
  assert.equal(rows[1][2], '−14줄')
  assert.equal(rows[2][2], '+6 −2 ~3줄')

  const onlyAdded = buildReport({
    code: { ...CROSS, items: [file('a/a.pc', 'modified', { added: 4 })] },
    schema: null,
  })
  assert.equal(rowsOf(onlyAdded)[1][2], '+4줄')
})

test('스키마 목록은 종류별 바뀐 줄 수를 적고 기본키 변경을 따로 알린다', () => {
  const md = buildReport({ code: null, schema: full.schema })
  const rows = rowsOf(md).slice(1)
  assert.deepEqual(rows, [
    ['신규', 'TB_RPT_DAILY', '컬럼 8'],
    ['수정', 'TB_ORD', '컬럼 3 · 제약 1 · ⚠ 기본키 변경'],
  ])
})

test('바뀐 것이 없는 종류는 절을 두지 않는다 — 요약 표의 0건 이 답이다', () => {
  const md = buildReport({
    code: { ...CROSS, items: [file('a/a.pc', 'same')] },
    schema: { ...CROSS, items: [table('TB_A', 'same')] },
  })
  assert.deepEqual(rowsOf(md), [
    ['운영 → 테스트', '소스', '0건', '2026-09-01'],
    ['운영 → 테스트', '스키마', '0건', '2026-09-01'],
  ])
  assert.ok(!md.includes('##'))
})

test('이름에 | 가 섞여도 표가 깨지지 않는다', () => {
  const md = buildReport({ code: { ...CROSS, items: [file('a/x|y.pc', 'added', { bLines: 1 })] }, schema: null })
  assert.ok(md.includes('| 신규 | a/x\\|y.pc | +1줄 |'))
})

test('천 단위 쉼표를 붙인다', () => {
  const md = buildReport({ code: { ...CROSS, items: [file('a/big.pc', 'added', { bLines: 12345 })] }, schema: null })
  assert.ok(md.includes('+12,345줄'))
})

test('소스 본문은 싣지 않는다 — 공지로 퍼지는 문서다', () => {
  const md = buildReport(full)
  assert.ok(!md.includes('```'))
})

/* ---------------- 파일 이름 ---------------- */

test('파일 이름만 보고 무엇을 견줬는지 알 수 있다', () => {
  assert.equal(reportFileName(full), '비교보고서_운영-2026-09-01_테스트-2026-09-01.md')
})

test('환경이 없으면 날짜만, 파일 이름에 못 쓰는 글자는 _ 로 바꾼다', () => {
  assert.equal(
    reportFileName({
      code: { left: { env: '', date: 'rel:1' }, right: { env: '', date: 'rel 2' }, items: [] },
      schema: null,
    }),
    '비교보고서_rel_1_rel_2.md'
  )
})

test('아무것도 없으면 기본 이름', () => {
  assert.equal(reportFileName({ code: null, schema: null }), '비교보고서.md')
})
