import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  changeLegend,
  kindSummary,
  rowLabel,
  schemaChangeRows,
  sectionSummary,
  sideNames,
  tableLabel,
} from '../src/features/schema/schemaWording.ts'
import { compareSchemas } from '../src/lib/schemaDiff.ts'
import { parseSchema } from '../src/lib/schemaParse.ts'
import { DEFAULT_SCHEMA_CONFIG } from '../src/types.ts'

/**
 * 스키마 변경을 말로 푼 것 — 화면의 칩·목록·범례와 보고서의 문장이 같은 곳에서 나온다.
 *
 * 말은 추가 · 삭제 · 변경 셋뿐이고 늘 왼쪽 → 오른쪽으로 읽는다. 줄 색(초록·빨강·주황)과 같은 뜻이다.
 * 예전의 `운영에만` 은 빨간 줄에 붙어 "운영에만 있고 삭제됐다" 로 읽혔다 — 그 말이 다시 나오지 않는지도 본다.
 * 실제 덤프 모양을 파서·대조에 그대로 태워 화면과 같은 행으로 확인한다.
 */

const HEADERS = [
  '[COLUMN],TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,DATA_SCALE,NULLABLE',
  '[CONSTRAINT],TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE,COLUMN_NAME,TO_CHAR(POSITION)',
  '[INDEX],TABLE_NAME,INDEX_NAME,UNIQUNESS,COLUMN_NAME,TO_CHAR(COLUMN_POSITION)',
].join('\n')

const snap = (...lines: string[]) => parseSchema(`${HEADERS}\n${lines.join('\n')}`, DEFAULT_SCHEMA_CONFIG)

/** 왼쪽 · 오른쪽 덤프 한 쌍. 기본 TB_ORD 가 양쪽에 있고, 각 테스트가 다른 줄만 얹는다 */
const diff = (left: string[], right: string[]) =>
  compareSchemas(
    snap('[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N', ...left),
    snap('[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N', ...right)
  )

/* ---------------- 보고서 줄 — 테이블 · 구분 · 이름 · 내용 · 상태 ---------------- */

test('있던 컬럼의 타입이 바뀌면 내용은 왼쪽 → 오른쪽 값, 상태는 맨 끝에 타입 변경', () => {
  const rows = schemaChangeRows(
    diff(['[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,15,2,Y'], ['[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,18,2,Y'])
  )
  assert.deepEqual(rows, [['TB_ORD', '컬럼', 'ORD_AMT', 'NUMBER(15,2) → NUMBER(18,2)', '타입 변경']])
})

test('NOT NULL 이 붙거나 풀리면 상태가 설정 · 해제를 말하고, 내용에 양쪽 값이 보인다', () => {
  const set = schemaChangeRows(diff(['[COLUMN],TB_ORD,ORD_DT,DATE,7,,,Y'], ['[COLUMN],TB_ORD,ORD_DT,DATE,7,,,N']))
  assert.deepEqual(set[0].slice(3), ['DATE → DATE NOT NULL', 'NOT NULL 설정'])
  const unset = schemaChangeRows(diff(['[COLUMN],TB_ORD,ORD_DT,DATE,7,,,N'], ['[COLUMN],TB_ORD,ORD_DT,DATE,7,,,Y']))
  assert.deepEqual(unset[0].slice(3), ['DATE NOT NULL → DATE', 'NOT NULL 해제'])
})

test('타입과 NOT NULL 이 함께 바뀌면 상태에 둘 다', () => {
  const rows = schemaChangeRows(
    diff(['[COLUMN],TB_ORD,ORD_MEMO,VARCHAR2,100,,,Y'], ['[COLUMN],TB_ORD,ORD_MEMO,VARCHAR2,200,,,N'])
  )
  assert.deepEqual(rows[0].slice(3), ['VARCHAR2(100) → VARCHAR2(200) NOT NULL', '타입·NOT NULL 변경'])
})

test('오른쪽에만 있으면 추가, 왼쪽에만 있으면 삭제 — 내용에는 있는 쪽의 값', () => {
  const rows = schemaChangeRows(
    diff(
      ['[INDEX],TB_ORD,IX_ORD_03,NONUNIQUE,ORD_STAT,1', '[INDEX],TB_ORD,IX_ORD_03,NONUNIQUE,ORD_DT,2'],
      ['[COLUMN],TB_ORD,ORD_MEMO,VARCHAR2,200,,,N', '[INDEX],TB_ORD,IX_ORD_04,UNIQUE,ORD_NO,1']
    )
  )
  assert.deepEqual(rows, [
    ['TB_ORD', '컬럼', 'ORD_MEMO', 'VARCHAR2(200) NOT NULL', '추가'],
    ['TB_ORD', '인덱스', 'IX_ORD_04', '유니크 (ORD_NO)', '추가'],
    ['TB_ORD', '인덱스', 'IX_ORD_03', '비유니크 (ORD_STAT, ORD_DT)', '삭제'],
  ])
})

test('같은 이름의 인덱스는 상태에 무엇이 달라졌는지 — 종류 · 컬럼', () => {
  const rows = schemaChangeRows(
    diff(['[INDEX],TB_ORD,IX_ORD_01,NONUNIQUE,ORD_DT,1'], ['[INDEX],TB_ORD,IX_ORD_01,UNIQUE,ORD_NO,1'])
  )
  assert.deepEqual(rows[0].slice(3), ['비유니크 (ORD_DT) → 유니크 (ORD_NO)', '종류·컬럼 변경'])
})

test('기본키가 걸린 줄은 상태 앞에 ⚠', () => {
  const rows = schemaChangeRows(
    diff(
      ['[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1'],
      ['[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1', '[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_SEQ,2']
    )
  )
  assert.deepEqual(rows, [
    ['TB_ORD', '제약', 'PK_ORD', '기본키 (ORD_NO) → 기본키 (ORD_NO, ORD_SEQ)', '⚠ 기본키 · 컬럼 변경'],
  ])
})

test('통째로 생기거나 없어진 테이블은 개수가 아니라 이름으로 — 무엇이 들었는지 보이게', () => {
  const rows = schemaChangeRows(
    compareSchemas(
      snap('[COLUMN],TB_OLD,A,CHAR,1,,,Y'),
      snap(
        '[COLUMN],TB_NEW,NEW_NO,CHAR,1,,,Y',
        '[COLUMN],TB_NEW,NEW_DT,DATE,7,,,Y',
        '[CONSTRAINT],TB_NEW,PK_NEW,P,NEW_NO,1',
        '[INDEX],TB_NEW,IX_NEW,NONUNIQUE,NEW_DT,1'
      )
    )
  )
  assert.deepEqual(rows, [
    ['TB_NEW', '테이블', '—', '컬럼: NEW_NO, NEW_DT · 제약: PK_NEW · 인덱스: IX_NEW', '테이블 추가'],
    ['TB_OLD', '테이블', '—', '컬럼: A', '테이블 삭제'],
  ])
})

test('바뀌지 않은 테이블과 줄은 싣지 않는다', () => {
  assert.deepEqual(schemaChangeRows(diff([], [])), [])
})

test('"…에만" · "다름" 같은 말은 더 쓰지 않는다 — 색과 어긋나 헷갈렸다', () => {
  const rows = schemaChangeRows(
    diff(
      ['[COLUMN],TB_ORD,OLD_COL,CHAR,1,,,Y', '[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,15,2,N'],
      ['[COLUMN],TB_ORD,NEW_COL,CHAR,1,,,Y', '[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,18,2,Y']
    )
  )
  for (const row of rows) assert.doesNotMatch(row.join(' '), /에만|다름/)
})

/* ---------------- 화면 — 줄 앞 칩 · 목록 · 섹션 머리 ---------------- */

/** 대조 결과에서 그 이름의 줄을 찾는다 */
const rowOf = (tables: ReturnType<typeof diff>, kind: 'column' | 'constraint' | 'index', name: string) => {
  const row = tables.find((t) => t.name === 'TB_ORD')?.sections[kind].rows.find((r) => r.name === name)
  assert.ok(row, `${name} 줄이 있어야 한다`)
  return row
}

test('칩 — 추가 · 삭제 · 무엇 변경', () => {
  const t = diff(
    [
      '[COLUMN],TB_ORD,OLD_COL,CHAR,1,,,Y',
      '[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,15,2,Y',
      '[COLUMN],TB_ORD,ORD_MEMO,VARCHAR2,100,,,Y',
      '[INDEX],TB_ORD,IX_A,NONUNIQUE,ORD_DT,1',
    ],
    [
      '[COLUMN],TB_ORD,NEW_COL,CHAR,1,,,Y',
      '[COLUMN],TB_ORD,ORD_AMT,NUMBER,22,18,2,Y',
      '[COLUMN],TB_ORD,ORD_MEMO,VARCHAR2,200,,,N',
      '[INDEX],TB_ORD,IX_A,UNIQUE,ORD_NO,1',
    ]
  )
  assert.equal(rowLabel('column', rowOf(t, 'column', 'NEW_COL')), '추가')
  assert.equal(rowLabel('column', rowOf(t, 'column', 'OLD_COL')), '삭제')
  assert.equal(rowLabel('column', rowOf(t, 'column', 'ORD_AMT')), '타입 변경')
  assert.equal(rowLabel('column', rowOf(t, 'column', 'ORD_MEMO')), '타입·NOT NULL 변경')
  assert.equal(rowLabel('index', rowOf(t, 'index', 'IX_A')), '종류·컬럼 변경')
})

test('칩 — NOT NULL 만 바뀌었으면 설정 · 해제까지 말한다', () => {
  const set = diff(['[COLUMN],TB_ORD,ORD_DT,DATE,7,,,Y'], ['[COLUMN],TB_ORD,ORD_DT,DATE,7,,,N'])
  assert.equal(rowLabel('column', rowOf(set, 'column', 'ORD_DT')), 'NOT NULL 설정')
  const unset = diff(['[COLUMN],TB_ORD,ORD_DT,DATE,7,,,N'], ['[COLUMN],TB_ORD,ORD_DT,DATE,7,,,Y'])
  assert.equal(rowLabel('column', rowOf(unset, 'column', 'ORD_DT')), 'NOT NULL 해제')
})

test('칩 — 바뀌지 않은 줄은 빈 문자열 (칩을 그리지 않는다)', () => {
  assert.equal(rowLabel('column', rowOf(diff([], []), 'column', 'ORD_NO')), '')
})

test('목록 배지 — 통째로 생기거나 없어진 테이블에만 붙는다', () => {
  const t = compareSchemas(
    snap('[COLUMN],TB_OLD,A,CHAR,1,,,Y', '[COLUMN],TB_ORD,A,CHAR,1,,,Y'),
    snap('[COLUMN],TB_NEW,A,CHAR,1,,,Y', '[COLUMN],TB_ORD,A,CHAR,2,,,Y')
  )
  const label = (name: string) => tableLabel(t.find((x) => x.name === name)!)
  assert.equal(label('TB_NEW'), '테이블 추가')
  assert.equal(label('TB_OLD'), '테이블 삭제')
  assert.equal(label('TB_ORD'), '', '안의 무엇이 바뀐 테이블에는 배지를 달지 않는다')
})

test('목록 둘째 줄 — 종류별로 몇 줄이 바뀌었는지 글자로', () => {
  const t = diff(
    ['[COLUMN],TB_ORD,A,CHAR,1,,,Y', '[INDEX],TB_ORD,IX_A,NONUNIQUE,ORD_NO,1'],
    ['[COLUMN],TB_ORD,A,CHAR,2,,,Y', '[COLUMN],TB_ORD,B,CHAR,1,,,Y', '[INDEX],TB_ORD,IX_A,UNIQUE,ORD_NO,1']
  )
  assert.equal(kindSummary(t.find((x) => x.name === 'TB_ORD')!), '컬럼 2 · 인덱스 1')
})

test('섹션 머리 — 칩과 같은 말로 세고, 0 인 것은 뺀다', () => {
  assert.deepEqual(sectionSummary({ added: 2, removed: 0, modified: 1 }), [
    { status: 'added', text: '추가 2' },
    { status: 'modified', text: '변경 1' },
  ])
  assert.deepEqual(sectionSummary({ added: 0, removed: 0, modified: 0 }), [])
})

/* ---------------- 범례 — 말을 실제 이름으로 푼다 ---------------- */

test('환경이 다르면 범례가 환경 이름으로 추가 · 삭제를 푼다', () => {
  const names = sideNames({ env: '운영', date: '2026-09-01' }, { env: '테스트', date: '2026-09-01' })
  assert.deepEqual(names, { left: '운영', right: '테스트' })
  assert.deepEqual(
    changeLegend(names).map((l) => `${l.word} ${l.meaning}`),
    ['추가 테스트에는 있고 운영에는 없음', '삭제 운영에는 있고 테스트에는 없음', '변경 양쪽에 다 있지만 값이 다름']
  )
})

test('같은 환경이면 날짜로 푼다 — 환경 이름은 양쪽이 같아 아무것도 가르지 못한다', () => {
  const names = sideNames({ env: '운영', date: '2026-08-01' }, { env: '운영', date: '2026-09-01' })
  assert.deepEqual(names, { left: '2026-08-01', right: '2026-09-01' })
  assert.equal(changeLegend(names)[0].meaning, '2026-09-01에는 있고 2026-08-01에는 없음')
})

test('환경도 날짜도 다르면 둘 다 적는다', () => {
  assert.deepEqual(sideNames({ env: '운영', date: '2026-09-01' }, { env: '테스트', date: '2026-08-15' }), {
    left: '운영 2026-09-01',
    right: '테스트 2026-08-15',
  })
})

test('범례는 어느 쪽에 있는지를 함께 준다 — 화면이 그 이름을 환경 색 태그로 그린다', () => {
  assert.deepEqual(
    changeLegend({ left: '운영', right: '테스트' }).map((l) => [l.word, l.has]),
    [
      ['추가', 'right'],
      ['삭제', 'left'],
      ['변경', null],
    ]
  )
})

test('범례 색은 줄 색과 같은 상태를 가리킨다 — 추가 초록 · 삭제 빨강 · 변경 주황', () => {
  assert.deepEqual(
    changeLegend({ left: 'A', right: 'B' }).map((l) => [l.status, l.word]),
    [
      ['added', '추가'],
      ['removed', '삭제'],
      ['modified', '변경'],
    ]
  )
})
