import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  diagnoseMalformed,
  formatType,
  parseSchema,
  unwrapFieldName,
} from '../src/lib/schemaParse.ts'
import { DEFAULT_SCHEMA_CONFIG, type SchemaConfig } from '../src/types.ts'

/**
 * 스키마 덤프의 **읽기**만 다룬다 (좌우 대조는 schemaDiff.test.ts).
 *
 * 이 파일이 지키는 것은 "값을 그대로 믿지 않는다" 하나다. Oracle 딕셔너리는 사람이
 * 읽으라고 만든 표가 아니라서, 그대로 견주면 없는 변경이 생기는 자리가 세 곳 있다.
 */

const CFG: SchemaConfig = DEFAULT_SCHEMA_CONFIG

const HEADERS = [
  "[COLUMN],TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,DATA_SCALE,NULLABLE",
  '[CONSTRAINT],TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE,COLUMN_NAME,TO_CHAR(POSITION)',
  '[INDEX],TABLE_NAME,INDEX_NAME,UNIQUNESS,COLUMN_NAME,TO_CHAR(COLUMN_POSITION)',
].join('\n')

const dump = (...lines: string[]): string => `${HEADERS}\n${lines.join('\n')}`

const tableNamed = (raw: string, name: string) => {
  const found = parseSchema(raw, CFG).tables.find((t) => t.name === name)
  assert.ok(found, `${name} 테이블이 없다`)
  return found
}

/* ---------------- 헤더에서 필드 배치 읽기 ---------------- */

test('함수로 감싸인 헤더 칸에서 딕셔너리 컬럼명만 뽑는다', () => {
  assert.equal(unwrapFieldName("NVL(TO_CHAR(DATA_LENGTH,''))"), 'DATA_LENGTH')
  assert.equal(unwrapFieldName('TO_CHAR(COLUMN_POSITION)'), 'COLUMN_POSITION')
  assert.equal(unwrapFieldName('TABLE_NAME'), 'TABLE_NAME')
})

test('헤더가 없어도 기본 배치로 읽는다', () => {
  const table = tableNamed('[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N', 'TB_ORD')
  assert.deepEqual(table.columns, [{ name: 'ORD_NO', type: 'VARCHAR2(20)', nullable: false }])
})

test('헤더에 컬럼이 하나 늘어도 뒤 필드를 놓치지 않는다', () => {
  // SELECT 목록이 바뀌어도 도구를 고칠 필요가 없어야 한다
  const raw = [
    '[COLUMN],TABLE_NAME,OWNER,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,DATA_SCALE,NULLABLE',
    '[COLUMN],TB_ORD,APPUSER,ORD_NO,VARCHAR2,20,,,N',
  ].join('\n')
  assert.deepEqual(tableNamed(raw, 'TB_ORD').columns, [
    { name: 'ORD_NO', type: 'VARCHAR2(20)', nullable: false },
  ])
})

test('빈 칸이 연달아 와도 뒤 필드가 밀리지 않는다', () => {
  // NVL(…,'') 로 빈 값이 오므로 `||` 가 이어 붙는 것이 정상이다
  const table = tableNamed(dump('[COLUMN],TB_ORD,ORD_DT,DATE,7,,,Y'), 'TB_ORD')
  assert.deepEqual(table.columns, [{ name: 'ORD_DT', type: 'DATE', nullable: true }])
})

/* ---------------- 함정 1 · 타입 합치기 ---------------- */

test('문자형만 DATA_LENGTH 를 쓴다', () => {
  assert.equal(formatType('VARCHAR2', '20', '', ''), 'VARCHAR2(20)')
  assert.equal(formatType('CHAR', '1', '', ''), 'CHAR(1)')
})

test('NUMBER 의 DATA_LENGTH 22 · DATE 의 7 은 버린다 — 내부 저장 크기라 뜻이 없다', () => {
  assert.equal(formatType('NUMBER', '22', '', ''), 'NUMBER')
  assert.equal(formatType('DATE', '7', '', ''), 'DATE')
  assert.equal(formatType('CLOB', '4000', '', ''), 'CLOB')
})

test('NUMBER 는 자릿수·소수점으로 적는다', () => {
  assert.equal(formatType('NUMBER', '22', '15', '2'), 'NUMBER(15,2)')
})

test('소수점 0 은 정수라는 뜻이라 자릿수만 적는다', () => {
  // NUMBER(10,0) 과 NUMBER(10) 이 갈리면 같은 컬럼이 바뀐 것처럼 보인다
  assert.equal(formatType('NUMBER', '22', '10', '0'), 'NUMBER(10)')
})

test('길이 표기가 달라도 같은 값이면 같은 타입이 된다', () => {
  // 덤프에 따라 `020` 처럼 자리를 채워 오는 경우가 있다
  assert.equal(formatType('VARCHAR2', '020', '', ''), formatType('VARCHAR2', '20', '', ''))
})

/* ---------------- NULLABLE ---------------- */

test('NULLABLE 이 N 이면 NOT NULL 이다 (Oracle 딕셔너리 규약)', () => {
  const table = tableNamed(
    dump('[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N', '[COLUMN],TB_ORD,ORD_MEMO,VARCHAR2,200,,,Y'),
    'TB_ORD'
  )
  assert.equal(table.columns[0].nullable, false)
  assert.equal(table.columns[1].nullable, true)
})

/* ---------------- 함정 2 · 시스템이 붙인 이름 ---------------- */

test('SYS_C 로 시작하는 제약은 시스템이 붙인 이름으로 본다', () => {
  const table = tableNamed(
    dump('[CONSTRAINT],TB_ORD,SYS_C0011234,C,ORD_NO,1', '[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1'),
    'TB_ORD'
  )
  const byName = new Map(table.constraints.map((c) => [c.name, c]))
  assert.equal(byName.get('SYS_C0011234')?.systemNamed, true)
  assert.equal(byName.get('PK_ORD')?.systemNamed, false)
})

test('휴지통 객체(BIN$…)도 시스템 이름으로 본다', () => {
  const table = tableNamed(dump('[INDEX],TB_ORD,BIN$abc==$0,NONUNIQUE,ORD_DT,1'), 'TB_ORD')
  assert.equal(table.indexes[0].systemNamed, true)
})

test('판정 규칙을 비우면 아무것도 접지 않는다', () => {
  const table = tableNamed(
    dump('[CONSTRAINT],TB_ORD,SYS_C0011234,C,ORD_NO,1'),
    'TB_ORD'
  )
  assert.equal(table.constraints[0].systemNamed, true)

  const off = parseSchema(dump('[CONSTRAINT],TB_ORD,SYS_C0011234,C,ORD_NO,1'), {
    ...CFG,
    systemNamePattern: '',
  })
  assert.equal(off.tables[0].constraints[0].systemNamed, false)
})

test('규칙이 깨진 정규식이어도 비교가 죽지 않는다 — 아무것도 접지 않고 넘어간다', () => {
  const broken = parseSchema(dump('[CONSTRAINT],TB_ORD,SYS_C1,C,ORD_NO,1'), {
    ...CFG,
    systemNamePattern: '^(SYS_',
  })
  assert.equal(broken.tables[0].constraints[0].systemNamed, false)
})

/* ---------------- 함정 3 · 여러 줄을 하나로 ---------------- */

test('다중 컬럼 기본키를 위치 순으로 한 줄로 묶는다', () => {
  const table = tableNamed(
    dump('[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1', '[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_SEQ,2'),
    'TB_ORD'
  )
  assert.equal(table.constraints.length, 1)
  assert.deepEqual(table.constraints[0].columns, ['ORD_NO', 'ORD_SEQ'])
  assert.equal(table.constraints[0].kind, 'P')
})

test('줄이 뒤섞여 와도 POSITION 순으로 세운다', () => {
  const table = tableNamed(
    dump(
      '[INDEX],TB_ORD,IX_ORD_01,NONUNIQUE,ORD_DT,2',
      '[INDEX],TB_ORD,IX_ORD_01,NONUNIQUE,ORD_STAT,1'
    ),
    'TB_ORD'
  )
  assert.deepEqual(table.indexes[0].columns, ['ORD_STAT', 'ORD_DT'])
})

test('같은 이름이라도 테이블이 다르면 섞이지 않는다', () => {
  const raw = dump('[CONSTRAINT],TB_ORD,PK_X,P,ORD_NO,1', '[CONSTRAINT],TB_PAY,PK_X,P,PAY_NO,1')
  assert.deepEqual(tableNamed(raw, 'TB_ORD').constraints[0].columns, ['ORD_NO'])
  assert.deepEqual(tableNamed(raw, 'TB_PAY').constraints[0].columns, ['PAY_NO'])
})

test('UNIQUNESS 오타를 그대로 받는다 — 덤프를 고치라고 요구하지 않는다', () => {
  const table = tableNamed(
    dump('[INDEX],TB_ORD,IX_A,UNIQUE,ORD_NO,1', '[INDEX],TB_ORD,IX_B,NONUNIQUE,ORD_DT,1'),
    'TB_ORD'
  )
  const byName = new Map(table.indexes.map((i) => [i.name, i]))
  assert.equal(byName.get('IX_A')?.unique, true)
  assert.equal(byName.get('IX_B')?.unique, false)
})

/* ---------------- 설명·잡음 ---------------- */

test('파일 맨 위 # 줄을 설명으로 읽는다', () => {
  const parsed = parseSchema(
    ['# 주문계 스키마 — 2026-09 정기배포 반영본', '# 담당 김철수', HEADERS].join('\n'),
    CFG
  )
  assert.equal(parsed.description, '주문계 스키마 — 2026-09 정기배포 반영본\n담당 김철수')
})

test('본문 중간 주석은 설명으로 올리지 않는다', () => {
  const parsed = parseSchema(
    dump('[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N', '# ---- 여기부터 결제계 ----'),
    CFG
  )
  assert.equal(parsed.description, '')
})

test('종류를 못 알아본 줄은 세어 두고 나머지는 그대로 읽는다', () => {
  const parsed = parseSchema(
    dump('쓰레기 한 줄', '[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N', '[UNKNOWN],TB_ORD,X'),
    CFG
  )
  assert.equal(parsed.malformed, 2)
  assert.equal(parsed.tables.length, 1)
  assert.equal(parsed.tables[0].columns.length, 1)
})

test('메모장이 붙인 BOM 때문에 첫 줄이 죽지 않는다', () => {
  const parsed = parseSchema('﻿[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N', CFG)
  assert.equal(parsed.malformed, 0)
  assert.equal(parsed.tables[0].name, 'TB_ORD')
})

test('컬럼 줄이 없고 인덱스만 있는 테이블도 목록에 오른다', () => {
  const parsed = parseSchema(dump('[INDEX],TB_ONLY_IDX,IX_A,UNIQUE,A,1'), CFG)
  assert.deepEqual(
    parsed.tables.map((t) => t.name),
    ['TB_ONLY_IDX']
  )
})

test('빈 입력은 빈 스냅샷', () => {
  const empty = { description: '', tables: [], malformed: 0, malformedSample: [] }
  assert.deepEqual(parseSchema(null, CFG), empty)
  assert.deepEqual(parseSchema('', CFG), empty)
})

test('구분자를 바꿀 수 있다 — 파이프로 가른다', () => {
  const parsed = parseSchema('[COLUMN]|TB_ORD|ORD_NO|VARCHAR2|20|||N', { ...CFG, separator: '|' })
  assert.deepEqual(parsed.tables[0].columns, [
    { name: 'ORD_NO', type: 'VARCHAR2(20)', nullable: false },
  ])
})

/* ---------------- 왜 못 읽었는지 짚어 준다 ---------------- */

test('못 읽은 줄은 원문을 함께 들고 온다 — 수만 알려 주면 원인을 못 가린다', () => {
  const parsed = parseSchema('[COLUMN]|TB_ORD|ORD_NO|VARCHAR2|20|||N', CFG)
  assert.equal(parsed.malformed, 1)
  assert.deepEqual(parsed.malformedSample, ['[COLUMN]|TB_ORD|ORD_NO|VARCHAR2|20|||N'])
})

test('구분자가 틀린 것을 짚어 준다', () => {
  const parsed = parseSchema(
    ['[COLUMN]|TB_ORD|ORD_NO|VARCHAR2|20|||N', '[INDEX]|TB_ORD|IX_A|UNIQUE|ORD_NO|1'].join('\n'),
    CFG
  )
  const hint = diagnoseMalformed(parsed.malformedSample, CFG)
  assert.match(hint, /구분자/)
  assert.match(hint, /'\|'/)
})

test('모르는 앞머리 태그를 짚어 준다', () => {
  const parsed = parseSchema('[테이블],TB_ORD,ORD_NO,VARCHAR2,20,,,N', CFG)
  assert.equal(parsed.malformed, 1)
  assert.match(diagnoseMalformed(parsed.malformedSample, CFG), /\[테이블\]/)
})

test('앞머리가 아예 없는 것을 짚어 준다', () => {
  const parsed = parseSchema('TB_ORD,ORD_NO,VARCHAR2,20,,,N', CFG)
  assert.equal(parsed.malformed, 1)
  assert.match(diagnoseMalformed(parsed.malformedSample, CFG), /종류 표시/)
})

test('짚을 것이 없으면 빈 문자열 — 없는 원인을 지어내지 않는다', () => {
  assert.equal(diagnoseMalformed([], CFG), '')
})

test('표본은 몇 개까지만 — 덤프가 통째로 안 맞아도 알림이 화면을 덮지 않는다', () => {
  const many = Array.from({ length: 50 }, (_, i) => `[COLUMN]|TB|C${i}|VARCHAR2|1|||N`).join('\n')
  const parsed = parseSchema(many, CFG)
  assert.equal(parsed.malformed, 50)
  assert.equal(parsed.malformedSample.length, 3)
})
