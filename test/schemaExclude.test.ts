import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSchema } from '../src/lib/schemaParse.ts'
import { compareSchemas } from '../src/lib/schemaDiff.ts'
import {
  ALL_KINDS,
  applySchemaExclude,
  toggleSchemaExclude,
} from '../src/features/schema/schemaExclude.ts'
import { summarize } from '../src/features/schema/schemaView.ts'
import { DEFAULT_SCHEMA_CONFIG, type TableDiff } from '../src/types.ts'

/**
 * 스키마 제외 — 팀 규칙 파일 + 내 목록 + 종류 토글.
 *
 * 지켜야 할 것은 소스 비교와 같다. **거르는 게 아니라 접는다** — 접힌 수와 그중 바뀐
 * 수를 늘 남겨야, 접어 둔 자리에 들어온 변경이 묻히지 않는다.
 */

const HEADERS = [
  '[COLUMN],TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,DATA_SCALE,NULLABLE',
  '[CONSTRAINT],TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE,COLUMN_NAME,TO_CHAR(POSITION)',
  '[INDEX],TABLE_NAME,INDEX_NAME,UNIQUNESS,COLUMN_NAME,TO_CHAR(COLUMN_POSITION)',
].join('\n')

const snap = (...lines: string[]) =>
  parseSchema(`${HEADERS}\n${lines.join('\n')}`, DEFAULT_SCHEMA_CONFIG)

const compare = (left: string[], right: string[]): TableDiff[] =>
  compareSchemas(snap(...left), snap(...right))

const named = (tables: readonly TableDiff[], name: string): TableDiff => {
  const found = tables.find((t) => t.name === name)
  assert.ok(found, `${name} 이 결과에 없다`)
  return found
}

/** 감사 컬럼만 바뀐 테이블 하나 + 진짜로 바뀐 테이블 하나 */
const TABLES = compare(
  [
    '[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N',
    '[COLUMN],TB_ORD,REG_DTM,DATE,7,,,N',
    '[COLUMN],TB_ORD_BAK,OLD_NO,VARCHAR2,20,,,N',
    '[INDEX],TB_ORD,IX_ORD_TMP,NONUNIQUE,ORD_NO,1',
  ],
  [
    '[COLUMN],TB_ORD,ORD_NO,VARCHAR2,30,,,N',
    '[COLUMN],TB_ORD,REG_DTM,TIMESTAMP,11,,,N',
    '[COLUMN],TB_ORD_BAK,OLD_NO,VARCHAR2,40,,,N',
    '[INDEX],TB_ORD,IX_ORD_TMP,UNIQUE,ORD_NO,1',
  ]
)

const apply = (team: string[], mine: string, kinds = ALL_KINDS) =>
  applySchemaExclude(TABLES, team, mine, kinds)

/* ---------------- 문법 — 소스 제외 목록과 같은 것을 쓴다 ---------------- */

test('테이블 이름만 적으면 그 테이블과 그 아래 전부가 접힌다', () => {
  const out = apply([], 'TB_ORD_BAK')
  const bak = named(out.tables, 'TB_ORD_BAK')
  assert.equal(bak.excluded, true)
  assert.equal(out.excludedTables, 1)
  // 그 안의 줄도 함께 접힌다
  assert.equal(bak.sections.column.rows[0].excluded, true)
  assert.equal(bak.sections.column.total, 0)
})

test('테이블.컬럼 으로 적으면 그 자리만 접힌다', () => {
  const out = apply([], 'TB_ORD.REG_DTM')
  const ord = named(out.tables, 'TB_ORD')
  assert.ok(!ord.excluded)
  const byName = new Map(ord.sections.column.rows.map((r) => [r.name, r]))
  assert.equal(byName.get('REG_DTM')?.excluded, true)
  assert.equal(byName.get('ORD_NO')?.excluded, false)
})

test('*.이름 으로 적으면 모든 테이블의 그 컬럼이 접힌다 — 감사 컬럼용', () => {
  const out = apply([], '*.REG_DTM')
  const ord = named(out.tables, 'TB_ORD')
  assert.equal(ord.sections.column.rows.find((r) => r.name === 'REG_DTM')?.excluded, true)
  assert.equal(out.excludedRows, 1)
})

test('이름 글로브로 인덱스·제약도 접는다', () => {
  const out = apply([], 'IX_*_TMP')
  const ord = named(out.tables, 'TB_ORD')
  assert.equal(ord.sections.index.rows[0].excluded, true)
  assert.equal(ord.sections.index.total, 0)
})

/* ---------------- 세기 — 접은 것은 변경으로 치지 않는다 ---------------- */

test('접은 줄은 변경으로 세지 않는다 — 그래야 접어 둔 보람이 있다', () => {
  const before = named(TABLES, 'TB_ORD')
  assert.equal(before.status, 'modified')

  const out = apply([], 'TB_ORD.ORD_NO\nTB_ORD.REG_DTM\nIX_ORD_TMP')
  const after = named(out.tables, 'TB_ORD')
  assert.equal(after.status, 'same')
  assert.deepEqual(after.changedKinds, [])
})

test('접은 줄 중 바뀐 수는 남긴다 — 접은 자리의 변경이 묻히면 안 된다', () => {
  const out = apply([], '*.REG_DTM')
  const ord = named(out.tables, 'TB_ORD')
  assert.equal(ord.sections.column.excludedHidden, 1)
  assert.equal(ord.sections.column.excludedChanged, 1)
  assert.equal(out.excludedRowsChanged, 1)
})

test('접은 테이블은 요약의 분모에서도 빠진다', () => {
  assert.equal(summarize(TABLES).tables, 2)
  assert.equal(summarize(apply([], 'TB_ORD_BAK').tables).tables, 1)
})

test('원본을 고치지 않는다 — 규칙을 지우면 되돌아와야 한다', () => {
  apply([], 'TB_ORD_BAK')
  assert.equal(named(TABLES, 'TB_ORD_BAK').excluded, undefined)
  assert.equal(named(apply([], '').tables, 'TB_ORD_BAK').excluded, false)
})

/* ---------------- 두 목록 ---------------- */

test('팀 규칙과 내 목록을 갈라 표시한다 — 고칠 자리가 다르다', () => {
  const out = apply(['TB_ORD_BAK'], '*.REG_DTM')
  assert.equal(named(out.tables, 'TB_ORD_BAK').excludedLocal, false)
  const reg = named(out.tables, 'TB_ORD').sections.column.rows.find((r) => r.name === 'REG_DTM')
  assert.equal(reg?.excludedLocal, true)
  assert.equal(out.byMine, 1)
})

test('같은 것을 양쪽에 적었으면 팀 규칙 쪽으로 본다', () => {
  const out = apply(['TB_ORD_BAK'], 'TB_ORD_BAK')
  assert.equal(named(out.tables, 'TB_ORD_BAK').excludedLocal, false)
  assert.equal(out.byMine, 0)
})

/* ---------------- 종류 토글 ---------------- */

test('종류를 끄면 그 종류가 통째로 접힌다', () => {
  const out = apply([], '', { column: true, constraint: true, index: false })
  const ord = named(out.tables, 'TB_ORD')
  assert.equal(ord.sections.index.total, 0)
  assert.equal(ord.sections.index.excludedHidden, 1)
  assert.deepEqual(out.offKinds, ['index'])
  // 컬럼은 그대로 남는다
  assert.ok(ord.sections.column.total > 0)
})

test('종류를 다 끄면 모든 테이블이 동일해진다', () => {
  const out = apply([], '', { column: false, constraint: false, index: false })
  assert.deepEqual(
    out.tables.filter((t) => t.status !== 'same').map((t) => t.name),
    []
  )
})

/* ---------------- 넣고 빼기 ---------------- */

test('없으면 넣는다 — 테이블과 멤버를 갈라 적는다', () => {
  assert.equal(toggleSchemaExclude('', 'TB_ORD'), 'TB_ORD')
  assert.equal(toggleSchemaExclude('TB_ORD', 'TB_PAY', 'PAY_NO'), 'TB_ORD\nTB_PAY.PAY_NO')
})

test('있으면 뺀다', () => {
  assert.equal(toggleSchemaExclude('TB_ORD', 'TB_ORD'), '')
  assert.equal(toggleSchemaExclude('TB_ORD\nTB_PAY.PAY_NO', 'TB_PAY', 'PAY_NO'), 'TB_ORD')
})

test('글로브에 걸려 접힌 것은 그 글로브를 뺀다 — 이름만 지우면 버튼이 안 먹는다', () => {
  const next = toggleSchemaExclude('*.REG_DTM', 'TB_ORD', 'REG_DTM')
  assert.equal(next, '')
  const out = applySchemaExclude(TABLES, [], next)
  assert.equal(out.excludedRows, 0)
})

test('넣고 다시 누르면 원래대로 돌아온다', () => {
  const added = toggleSchemaExclude('tmp', 'TB_ORD', 'REG_DTM')
  assert.equal(applySchemaExclude(TABLES, [], added).excludedRows, 1)
  const back = toggleSchemaExclude(added, 'TB_ORD', 'REG_DTM')
  assert.equal(applySchemaExclude(TABLES, [], back).excludedRows, 0)
})
