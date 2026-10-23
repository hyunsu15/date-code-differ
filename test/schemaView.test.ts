import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapshotSortKey } from '../src/lib/fileTypes.ts'
import { particle } from '../src/lib/format.ts'
import { filterTables, matchSchemaDate, summarize } from '../src/features/schema/schemaView.ts'
import { parseSchema } from '../src/lib/schemaParse.ts'
import { compareSchemas } from '../src/lib/schemaDiff.ts'
import { DEFAULT_SCHEMA_CONFIG, type SchemaSnapshotRef } from '../src/types.ts'

/**
 * 스키마 화면의 계산.
 *
 * 핵심은 **날짜 맞추기**다. 스키마 덤프는 소스 배포와 주기가 달라 고른 날짜에 딱 맞는
 * 파일이 없는 것이 보통이라, 이 규칙이 틀리면 사람이 엉뚱한 시점의 스키마를 본다.
 */

/** 서버가 주는 모양 그대로 — 최신순 */
const refs = (...ids: string[]): SchemaSnapshotRef[] =>
  ids.map((id) => ({ id, sortKey: snapshotSortKey(id) }))

/* ---------------- 날짜 맞추기 ---------------- */

test('같은 날짜가 있으면 그것을 쓴다', () => {
  const list = refs('2026-09-01', '2026-08-01', '2026-07-01')
  assert.equal(matchSchemaDate(list, '2026-08-01'), '2026-08-01')
})

test('없으면 날 수로 가장 가까운 것 — 앞쪽이 가까우면 앞쪽', () => {
  const list = refs('2026-09-01', '2026-07-28', '2026-06-30')
  assert.equal(matchSchemaDate(list, '2026-08-01'), '2026-07-28')
})

test('뒤쪽이 더 가까우면 뒤쪽 — 하루 뒤 덤프를 두고 한 달 전 것을 고르지 않는다', () => {
  const list = refs('2026-09-02', '2026-08-01')
  assert.equal(matchSchemaDate(list, '2026-09-01'), '2026-09-02')
})

test('거리가 같으면 앞의 것 — 그 시점에 이미 걸려 있던 스키마다', () => {
  const list = refs('2026-08-03', '2026-07-30')
  assert.equal(matchSchemaDate(list, '2026-08-01'), '2026-07-30')
})

test('거리는 날 수로 잰다 — 달이 바뀌어도 틀리지 않는다', () => {
  // 숫자 그대로 빼면 20260801 − 20260730 = 71 이라 4일 뒤인 08-05 가 더 가까워 보인다
  const list = refs('2026-08-05', '2026-07-30')
  assert.equal(matchSchemaDate(list, '2026-08-01'), '2026-07-30')
})

test('스키마가 전부 더 나중이면 그중 가장 이른 것 — 그게 가장 가깝다', () => {
  const list = refs('2026-09-01', '2026-08-15')
  assert.equal(matchSchemaDate(list, '2026-01-01'), '2026-08-15')
})

test('스키마가 전부 더 이전이면 그중 가장 늦은 것', () => {
  const list = refs('2026-09-01', '2026-08-15')
  assert.equal(matchSchemaDate(list, '2026-12-31'), '2026-09-01')
})

test('목록이 비면 빈 문자열 (그 환경에 스키마가 없다)', () => {
  assert.equal(matchSchemaDate([], '2026-08-01'), '')
})

test('폴더 이름 모양이 달라도 날짜로 읽히면 맞춘다', () => {
  // 소스는 `20260801`, 스키마는 `2026-08-01` 처럼 표기가 갈릴 수 있다
  const list = refs('2026-09-01', '2026-08-01', '2026-07-01')
  assert.equal(matchSchemaDate(list, '20260801'), '2026-08-01')
})

test('날짜로 안 읽히는 이름을 골라도 뭔가는 준다', () => {
  const list = refs('2026-09-01', '2026-08-01')
  assert.equal(matchSchemaDate(list, 'latest'), '2026-08-01')
})

/* ---------------- 요약·필터 ---------------- */

const HEADERS = [
  '[COLUMN],TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,DATA_SCALE,NULLABLE',
  '[CONSTRAINT],TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE,COLUMN_NAME,TO_CHAR(POSITION)',
  '[INDEX],TABLE_NAME,INDEX_NAME,UNIQUNESS,COLUMN_NAME,TO_CHAR(COLUMN_POSITION)',
].join('\n')

const snap = (...lines: string[]) =>
  parseSchema(`${HEADERS}\n${lines.join('\n')}`, DEFAULT_SCHEMA_CONFIG)

const tables = compareSchemas(
  snap(
    '[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N',
    '[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,15,2,Y',
    '[INDEX],TB_PAY,IX_PAY,NONUNIQUE,PAY_DT,1',
    '[COLUMN],TB_CUST,CUST_NO,VARCHAR2,12,,,N',
    '[CONSTRAINT],TB_CUST,SYS_C0011,C,CUST_NO,1'
  ),
  snap(
    '[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N',
    '[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,18,2,Y',
    '[INDEX],TB_PAY,IX_PAY,UNIQUE,PAY_DT,1',
    '[COLUMN],TB_CUST,CUST_NO,VARCHAR2,12,,,N',
    '[CONSTRAINT],TB_CUST,SYS_C0099,C,CUST_NO,1'
  )
)

test('요약은 종류별로 "변경된 테이블 수" 를 센다', () => {
  const s = summarize(tables)
  assert.equal(s.tables, 3)
  assert.equal(s.changed, 2)
  assert.deepEqual(s.changedByKind, { column: 1, constraint: 0, index: 1 })
  // SYS_C 번호만 다른 TB_CUST 는 변경으로 세지 않고, 접은 줄 수만 남긴다
  assert.equal(s.systemHidden, 2)
})

test('종류 필터는 그 종류가 바뀐 테이블만 남긴다', () => {
  const only = filterTables(tables, { query: '', onlyChanged: true, kind: 'index' })
  assert.deepEqual(
    only.map((t) => t.name),
    ['TB_PAY']
  )
})

test('검색은 컬럼 이름까지 본다 — "이 컬럼이 어느 테이블에" 를 자주 묻는다', () => {
  const found = filterTables(tables, { query: 'ord_amt', onlyChanged: false, kind: null })
  assert.deepEqual(
    found.map((t) => t.name),
    ['TB_ORD']
  )
})

test('변경된 테이블만 켜면 동일한 테이블이 빠진다', () => {
  const changed = filterTables(tables, { query: '', onlyChanged: true, kind: null })
  assert.deepEqual(
    changed.map((t) => t.name),
    ['TB_ORD', 'TB_PAY']
  )
})

/* ---------------- 문구 조립 ---------------- */

test('종류 이름에 맞는 조사를 붙인다 — "인덱스이" 가 나오면 안 된다', () => {
  assert.equal(`인덱스${particle('인덱스', '이', '가')}`, '인덱스가')
  assert.equal(`컬럼${particle('컬럼', '이', '가')}`, '컬럼이')
  assert.equal(`제약${particle('제약', '이', '가')}`, '제약이')
})
