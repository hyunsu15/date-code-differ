import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReport,
  reportFileName,
  type ReportInput,
  type SchemaReportPart,
} from '../src/features/report/report.ts'
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
  // 파일 전체 줄 수(aLines·bLines)와 비교한 줄 수(removed·added)를 일부러 다르게 — 보고서는 화면처럼 뒤엣것을 쓴다
  file('cmm/cmm_log.h', 'removed', { aLines: 14, removed: 11 }),
  file('rpt/rpt_daily.pc', 'added', { bLines: 70, added: 62 }),
  file('ord/ord_main.pc', 'same'),
]

const TABLES = [
  table('TB_ORD', 'modified', { column: { modified: 1, added: 1, removed: 1 }, constraint: { modified: 1 } }, true),
  table('TB_RPT_DAILY', 'added', { column: { added: 8 } }),
  table('TB_CUST', 'same'),
]

/** 스키마 쪽 — 따로 말하지 않으면 소스와 같은 날짜의 덤프를 쓴 것이다 */
const schemaPart = (
  items: TableDiff[],
  over: Partial<SchemaReportPart> = {}
): SchemaReportPart => ({
  ...CROSS,
  items,
  wanted: { left: CROSS.left.date, right: CROSS.right.date },
  sameDump: false,
  ...over,
})

const full: ReportInput = {
  code: { ...CROSS, items: FILES },
  schema: schemaPart(TABLES),
}

/** md 표 한 줄을 칸으로 */
const rowsOf = (md: string): string[][] =>
  md
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| ----') && !/^\| (환경|파일|테이블) \|/.test(l))
    .map((l) => l.slice(2, -2).split(' | '))

/* ---------------- 맨 위 요약 표 ---------------- */

test('맨 위 표에 환경·종류·변경 건수·날짜가 실린다 — 동일은 세지 않는다', () => {
  const rows = rowsOf(buildReport(full))
  assert.deepEqual(rows[0], ['운영 → 테스트', '소스', '3건', '2026-09-01'])
  assert.deepEqual(rows[1], ['운영 → 테스트', '스키마', '2건', '2026-09-01'])
})

test('제목에 무엇을 담았는지와 견준 두 환경이 들어간다', () => {
  assert.match(buildReport(full), /^# 소스·스키마 비교 보고서 \(운영 ↔ 테스트\)\n/)
  assert.match(buildReport({ code: full.code, schema: null }), /^# 소스 비교 보고서 \(운영 ↔ 테스트\)\n/)
  assert.match(buildReport({ code: null, schema: full.schema }), /^# 스키마 비교 보고서 \(운영 ↔ 테스트\)\n/)
})

test('스키마 보고서에는 소스 줄도, 소스 절도 없다', () => {
  const md = buildReport({ code: null, schema: full.schema })
  assert.deepEqual(rowsOf(md)[0], ['운영 → 테스트', '스키마', '2건', '2026-09-01'])
  assert.ok(!md.includes('소스 변경 내역'))
  assert.ok(!md.includes('| 소스 |'))
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

test('소스 목록은 파일 · 줄 수 · 상태 — 상태는 맨 끝, 스키마와 같은 말(추가 · 삭제 · 변경)', () => {
  const md = buildReport({ code: full.code, schema: null })
  assert.ok(md.includes('| 파일 | 줄 수 | 상태 |'))
  const rows = rowsOf(md).slice(1)
  assert.deepEqual(
    rows.map((r) => [r[0], r[2]]),
    [
      ['rpt/rpt_daily.pc', '추가'],
      ['cmm/cmm_log.h', '삭제'],
      ['pay/pay_proc.pc', '변경'],
    ]
  )
  assert.doesNotMatch(md, /신규|수정/, '예전 말은 남지 않는다')
})

test('줄 수는 화면 파일 목록과 같은 비교한 줄 기준 — 0 이 아닌 증감만 적는다', () => {
  const rows = rowsOf(buildReport({ code: full.code, schema: null })).slice(1)
  assert.equal(rows[0][1], '+62줄')
  assert.equal(rows[1][1], '−11줄', '파일 전체(14줄)가 아니라 화면과 같은 비교한 줄 수')
  assert.equal(rows[2][1], '+6 −2 ~3줄')

  const onlyAdded = buildReport({
    code: { ...CROSS, items: [file('a/a.pc', 'modified', { added: 4 })] },
    schema: null,
  })
  assert.equal(rowsOf(onlyAdded)[1][1], '+4줄')
})

test('스키마 절은 테이블 · 구분 · 이름 · 내용 · 상태 — 바뀐 항목마다 한 줄, 상태는 맨 끝', () => {
  // 칸 내용 자체는 schemaWording.test.ts 가 본다. 여기서는 표에 제대로 실리는지만
  const md = buildReport({ code: null, schema: full.schema })
  assert.ok(md.includes('| 테이블 | 구분 | 이름 | 내용 | 상태 |'))
  assert.deepEqual(rowsOf(md).slice(1), [['TB_RPT_DAILY', '테이블', '—', '—', '테이블 추가']])
})

test('스키마 절 머리에 말의 뜻을 실제 이름으로 적는다 — "추가" 가 누구 기준인지 되묻지 않게', () => {
  const md = buildReport({ code: null, schema: full.schema })
  const lines = md.split('\n')
  const head = lines.indexOf('## 스키마 변경 내역')
  assert.equal(
    lines[head + 2],
    '> 추가: 테스트에는 있고 운영에는 없음 · 삭제: 운영에는 있고 테스트에는 없음 · 변경: 양쪽에 다 있지만 값이 다름'
  )
})

test('바뀐 것이 없는 종류는 절을 두지 않는다 — 요약 표의 0건 이 답이다', () => {
  const md = buildReport({
    code: { ...CROSS, items: [file('a/a.pc', 'same')] },
    schema: schemaPart([table('TB_A', 'same')]),
  })
  assert.deepEqual(rowsOf(md), [
    ['운영 → 테스트', '소스', '0건', '2026-09-01'],
    ['운영 → 테스트', '스키마', '0건', '2026-09-01'],
  ])
  assert.ok(!md.includes('##'))
})

test('이름에 | 가 섞여도 표가 깨지지 않는다', () => {
  const md = buildReport({ code: { ...CROSS, items: [file('a/x|y.pc', 'added', { added: 1 })] }, schema: null })
  assert.ok(md.includes('| a/x\\|y.pc | +1줄 | 추가 |'))
})

test('천 단위 쉼표를 붙인다', () => {
  const md = buildReport({ code: { ...CROSS, items: [file('a/big.pc', 'added', { added: 12345 })] }, schema: null })
  assert.ok(md.includes('+12,345줄'))
})

test('소스 본문은 싣지 않는다 — 공지로 퍼지는 문서다', () => {
  const md = buildReport(full)
  assert.ok(!md.includes('```'))
})

/* ---------------- 스키마 날짜가 어긋났을 때 ---------------- */

const SAME_ENV = {
  left: { env: '운영', date: '2026-07-01' },
  right: { env: '운영', date: '2026-08-01' },
}

test('스키마 날짜가 소스와 같으면 따로 적지 않는다', () => {
  assert.ok(!buildReport(full).includes('※'))
})

test('가까운 덤프로 바꿔 썼으면 어느 날짜 대신 무엇을 썼는지 표 아래에 적는다', () => {
  const md = buildReport({
    code: { ...SAME_ENV, items: FILES },
    schema: schemaPart(TABLES, {
      left: { env: '운영', date: '2026-07-03' },
      right: { env: '운영', date: '2026-08-01' },
      wanted: { left: '2026-07-01', right: '2026-08-01' },
    }),
  })
  assert.ok(md.includes('※ 스키마는 같은 날짜의 덤프가 없어 가장 가까운 덤프로 비교했습니다 (2026-07-01 대신 2026-07-03).'))
  // 표가 끝난 뒤에 붙어야 표가 끊기지 않는다
  const lines = md.split('\n')
  const note = lines.findIndex((l) => l.startsWith('※'))
  assert.equal(lines[note - 1], '')
  assert.match(lines[note - 2], /^\| .* \| 스키마 \|/)
})

test('환경이 달라 양쪽이 똑같이 바뀌었으면 한 번만 적는다', () => {
  const md = buildReport({
    code: full.code,
    schema: schemaPart(TABLES, {
      left: { env: '운영', date: '2026-08-28' },
      right: { env: '테스트', date: '2026-08-28' },
    }),
  })
  assert.ok(md.includes('(2026-09-01 대신 2026-08-28).'))
})

test('두 날짜가 같은 덤프로 맞춰졌으면 0건이 아니라 — 로 두고 비교하지 않았다고 적는다', () => {
  const md = buildReport({
    code: { ...SAME_ENV, items: FILES },
    schema: schemaPart([], {
      left: { env: '운영', date: '2026-08-01' },
      right: { env: '운영', date: '2026-08-01' },
      wanted: { left: '2026-07-01', right: '2026-07-15' },
      sameDump: true,
    }),
  })
  assert.deepEqual(rowsOf(md)[1], ['운영', '스키마', '—', '2026-08-01'])
  assert.ok(md.includes('※ 스키마는 두 날짜 사이에 덤프가 없어 비교하지 않았습니다 (가장 가까운 덤프가 둘 다 2026-08-01).'))
  assert.ok(!md.includes('대신'), '"가장 가까운 것을 썼다" 는 말은 덧붙이지 않는다')
  assert.ok(!md.includes('## 스키마'))
})

/* ---------------- 파일 이름 ---------------- */

test('파일 이름만 보고 무엇을 견줬는지 알 수 있다', () => {
  assert.equal(reportFileName(full), '비교보고서_통합_운영-2026-09-01_테스트-2026-09-01.md')
  assert.equal(
    reportFileName({ code: full.code, schema: null }),
    '비교보고서_소스_운영-2026-09-01_테스트-2026-09-01.md'
  )
  assert.equal(
    reportFileName({ code: null, schema: full.schema }),
    '비교보고서_스키마_운영-2026-09-01_테스트-2026-09-01.md'
  )
})

test('환경이 없으면 날짜만, 파일 이름에 못 쓰는 글자는 _ 로 바꾼다', () => {
  assert.equal(
    reportFileName({
      code: { left: { env: '', date: 'rel:1' }, right: { env: '', date: 'rel 2' }, items: [] },
      schema: null,
    }),
    '비교보고서_소스_rel_1_rel_2.md'
  )
})

test('아무것도 없으면 기본 이름', () => {
  assert.equal(reportFileName({ code: null, schema: null }), '비교보고서.md')
})
