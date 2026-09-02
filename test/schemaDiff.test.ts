import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSchema } from '../src/lib/schemaParse.ts'
import { compareSchemas } from '../src/lib/schemaDiff.ts'
import { DEFAULT_SCHEMA_CONFIG, type TableDiff } from '../src/types.ts'

/**
 * 좌우 스키마 대조.
 *
 * 이 도구의 대표 용도는 **운영 ↔ 테스트** 비교다. 그래서 "내용이 같은데 다르게 보이는"
 * 경우를 막는 것이 첫째다 — 없는 변경이 수백 개 뜨는 화면은 아무도 안 본다.
 */

const HEADERS = [
  "[COLUMN],TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,DATA_SCALE,NULLABLE",
  '[CONSTRAINT],TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE,COLUMN_NAME,TO_CHAR(POSITION)',
  '[INDEX],TABLE_NAME,INDEX_NAME,UNIQUNESS,COLUMN_NAME,TO_CHAR(COLUMN_POSITION)',
].join('\n')

const snap = (...lines: string[]) =>
  parseSchema(`${HEADERS}\n${lines.join('\n')}`, DEFAULT_SCHEMA_CONFIG)

const compare = (left: string[], right: string[]): TableDiff[] =>
  compareSchemas(snap(...left), snap(...right))

const tableNamed = (tables: TableDiff[], name: string): TableDiff => {
  const found = tables.find((t) => t.name === name)
  assert.ok(found, `${name} 이 결과에 없다`)
  return found
}

/* ---------------- 함정 2 · 시스템 이름이 화면을 뒤덮지 않는다 ---------------- */

test('SYS_C 번호만 다르면 테이블은 동일하다 — 운영↔테스트에서 이게 안 되면 기능이 죽는다', () => {
  const tables = compare(
    ['[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N', '[CONSTRAINT],TB_ORD,SYS_C0011234,C,ORD_NO,1'],
    ['[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N', '[CONSTRAINT],TB_ORD,SYS_C0098765,C,ORD_NO,1']
  )
  const table = tableNamed(tables, 'TB_ORD')
  assert.equal(table.status, 'same')
  assert.deepEqual(table.changedKinds, [])
})

test('접은 줄 수는 남긴다 — 조용히 지우면 그 자리의 진짜 변경도 묻힌다', () => {
  const tables = compare(
    ['[CONSTRAINT],TB_ORD,SYS_C1,C,ORD_NO,1'],
    ['[CONSTRAINT],TB_ORD,SYS_C2,C,ORD_NO,1']
  )
  const section = tableNamed(tables, 'TB_ORD').sections.constraint
  assert.equal(section.rows.length, 0)
  // 양쪽 이름이 다르니 짝이 안 맞아 두 줄이 된다 — 둘 다 접힌 것을 세어 둔다
  assert.equal(section.systemHidden, 2)
})

test('사람이 이름 붙인 제약은 접지 않는다', () => {
  const tables = compare(
    ['[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1'],
    ['[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1', '[CONSTRAINT],TB_ORD,CK_ORD_STAT,C,ORD_STAT,1']
  )
  const section = tableNamed(tables, 'TB_ORD').sections.constraint
  assert.equal(section.systemHidden, 0)
  assert.equal(section.added, 1)
})

/* ---------------- 함정 1 · 타입이 같으면 같다 ---------------- */

test('NUMBER 의 DATA_LENGTH 가 달라도 자릿수가 같으면 동일하다', () => {
  const tables = compare(
    ['[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,15,2,Y'],
    ['[COLUMN],TB_ORD,ORD_AMT,NUMBER,38,15,2,Y']
  )
  assert.equal(tableNamed(tables, 'TB_ORD').status, 'same')
})

test('자릿수가 늘면 변경으로 잡고 좌우를 함께 보여준다', () => {
  const tables = compare(
    ['[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,15,2,Y'],
    ['[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,18,2,Y']
  )
  const row = tableNamed(tables, 'TB_ORD').sections.column.rows[0]
  assert.equal(row.status, 'modified')
  assert.equal(row.left?.value, 'NUMBER(15,2)')
  assert.equal(row.right?.value, 'NUMBER(18,2)')
})

test('NOT NULL 이 붙거나 풀린 것도 변경이다', () => {
  const tables = compare(
    ['[COLUMN],TB_ORD,ORD_MEMO,VARCHAR2,200,,,Y'],
    ['[COLUMN],TB_ORD,ORD_MEMO,VARCHAR2,200,,,N']
  )
  const row = tableNamed(tables, 'TB_ORD').sections.column.rows[0]
  assert.equal(row.status, 'modified')
  // 타입은 그대로고 NOT NULL 만 붙었다 — 값과 표시를 갈라 두므로 둘을 따로 본다
  assert.equal(row.left?.value, 'VARCHAR2(200)')
  assert.equal(row.left?.note ?? null, null)
  assert.equal(row.right?.value, 'VARCHAR2(200)')
  assert.equal(row.right?.note, 'NOT NULL')
})

/* ---------------- 함정 3 · 여러 줄이 하나로 묶여 견줘진다 ---------------- */

test('기본키에 컬럼이 하나 늘면 한 줄의 변경으로 보인다', () => {
  const tables = compare(
    ['[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1'],
    ['[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1', '[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_SEQ,2']
  )
  const section = tableNamed(tables, 'TB_ORD').sections.constraint
  // "신규 1 + 기존 그대로" 로 갈라지면 무슨 일이 났는지 안 보인다
  assert.equal(section.rows.length, 1)
  assert.equal(section.added, 0)
  assert.equal(section.modified, 1)
  assert.equal(section.rows[0].left?.value, 'ORD_NO')
  assert.equal(section.rows[0].right?.value, 'ORD_NO, ORD_SEQ')
})

test('기본키가 바뀌면 따로 표시한다 — 빈도는 낮고 위험은 크다', () => {
  const changed = compare(
    ['[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1'],
    ['[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1', '[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_SEQ,2']
  )
  assert.equal(tableNamed(changed, 'TB_ORD').primaryKeyChanged, true)

  const indexOnly = compare(
    ['[INDEX],TB_ORD,IX_A,NONUNIQUE,ORD_DT,1'],
    ['[INDEX],TB_ORD,IX_A,UNIQUE,ORD_DT,1']
  )
  assert.equal(tableNamed(indexOnly, 'TB_ORD').primaryKeyChanged, false)
})

test('인덱스의 유니크 여부가 바뀌면 배지로 갈린다', () => {
  const tables = compare(
    ['[INDEX],TB_ORD,IX_A,NONUNIQUE,ORD_DT,1'],
    ['[INDEX],TB_ORD,IX_A,UNIQUE,ORD_DT,1']
  )
  const row = tableNamed(tables, 'TB_ORD').sections.index.rows[0]
  assert.equal(row.status, 'modified')
  assert.equal(row.left?.badge, '비유니크')
  assert.equal(row.right?.badge, '유니크')
})

/* ---------------- 짝짓기와 순서 ---------------- */

test('컬럼 순서가 바뀐 것만으로는 변경이 아니다 — 이름으로 짝짓는다', () => {
  const tables = compare(
    ['[COLUMN],TB_ORD,A,VARCHAR2,1,,,Y', '[COLUMN],TB_ORD,B,VARCHAR2,1,,,Y'],
    ['[COLUMN],TB_ORD,B,VARCHAR2,1,,,Y', '[COLUMN],TB_ORD,A,VARCHAR2,1,,,Y']
  )
  assert.equal(tableNamed(tables, 'TB_ORD').status, 'same')
})

test('읽는 순서는 오른쪽(이후)을 따르고, 삭제된 컬럼은 원래 자리에 남는다', () => {
  const tables = compare(
    [
      '[COLUMN],TB_ORD,A,VARCHAR2,1,,,Y',
      '[COLUMN],TB_ORD,GONE,VARCHAR2,1,,,Y',
      '[COLUMN],TB_ORD,B,VARCHAR2,1,,,Y',
    ],
    [
      '[COLUMN],TB_ORD,A,VARCHAR2,1,,,Y',
      '[COLUMN],TB_ORD,B,VARCHAR2,1,,,Y',
      '[COLUMN],TB_ORD,NEW,VARCHAR2,1,,,Y',
    ]
  )
  const section = tableNamed(tables, 'TB_ORD').sections.column
  assert.deepEqual(
    section.rows.map((r) => `${r.name}:${r.status}`),
    ['A:same', 'GONE:removed', 'B:same', 'NEW:added']
  )
  assert.equal(section.added, 1)
  assert.equal(section.removed, 1)
})

test('한 줄도 잃지 않는다 — 좌우 순서가 완전히 어긋나도', () => {
  const tables = compare(
    ['[COLUMN],TB_ORD,A,VARCHAR2,1,,,Y', '[COLUMN],TB_ORD,B,VARCHAR2,1,,,Y'],
    ['[COLUMN],TB_ORD,C,VARCHAR2,1,,,Y', '[COLUMN],TB_ORD,B,VARCHAR2,1,,,Y']
  )
  const names = tableNamed(tables, 'TB_ORD').sections.column.rows.map((r) => r.name)
  assert.equal(new Set(names).size, names.length, '같은 이름이 두 번 나왔다')
  assert.deepEqual([...names].sort(), ['A', 'B', 'C'])
})

/* ---------------- 테이블 단위 ---------------- */

test('한쪽에만 있는 테이블은 신규·삭제로 잡고 컬럼까지 채워 준다', () => {
  const tables = compare([], ['[COLUMN],TB_NEW,A,VARCHAR2,1,,,Y'])
  const table = tableNamed(tables, 'TB_NEW')
  assert.equal(table.status, 'added')
  assert.equal(table.sections.column.added, 1)
  assert.equal(table.sections.column.rows[0].left, null)
})

test('변경이 있는 종류만 changedKinds 에 든다 — 밴드의 종류 필터가 이걸 본다', () => {
  const tables = compare(
    ['[COLUMN],TB_ORD,A,VARCHAR2,1,,,Y', '[INDEX],TB_ORD,IX_A,NONUNIQUE,A,1'],
    ['[COLUMN],TB_ORD,A,VARCHAR2,1,,,Y', '[INDEX],TB_ORD,IX_A,UNIQUE,A,1']
  )
  assert.deepEqual(tableNamed(tables, 'TB_ORD').changedKinds, ['index'])
})

test('양쪽이 완전히 같으면 모든 테이블이 동일이다', () => {
  const lines = [
    '[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N',
    '[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,15,2,Y',
    '[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1',
    '[INDEX],TB_ORD,IX_ORD_01,NONUNIQUE,ORD_AMT,1',
  ]
  assert.deepEqual(
    compare(lines, lines).map((t) => t.status),
    ['same']
  )
})

test('신규·삭제 테이블에는 기본키 경고를 붙이지 않는다 — 흔해지면 진짜 신호가 묻힌다', () => {
  const tables = compare([], ['[CONSTRAINT],TB_NEW,PK_NEW,P,A,1'])
  assert.equal(tableNamed(tables, 'TB_NEW').status, 'added')
  assert.equal(tableNamed(tables, 'TB_NEW').primaryKeyChanged, false)
})
