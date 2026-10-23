import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedFirst, shownItems, splitSame } from '../src/lib/changedFirst.ts'
import { filterTables } from '../src/features/schema/schemaView.ts'
import { compareSchemas } from '../src/lib/schemaDiff.ts'
import { parseSchema } from '../src/lib/schemaParse.ts'
import { DEFAULT_SCHEMA_CONFIG } from '../src/types.ts'

/**
 * "변경된 파일만 / 테이블만" 을 끄고 전체를 볼 때 — 바뀐 것을 위로, 동일한 것을 아래로.
 * 각 묶음 안의 순서(경로·이름순)는 그대로여야 한다.
 */

const item = (name: string, status: string) => ({ name, status })

test('바뀐 것(추가·삭제·변경)이 위, 동일이 아래 — 묶음 안 순서는 그대로', () => {
  const list = [
    item('a.pc', 'same'),
    item('b.pc', 'modified'),
    item('c.pc', 'same'),
    item('d.pc', 'added'),
    item('e.pc', 'removed'),
  ]
  assert.deepEqual(
    changedFirst(list).map((i) => i.name),
    ['b.pc', 'd.pc', 'e.pc', 'a.pc', 'c.pc']
  )
})

test('원래 배열을 고치지 않는다 · 빈 목록도 된다', () => {
  const list = [item('a', 'same'), item('b', 'modified')]
  changedFirst(list)
  assert.deepEqual(
    list.map((i) => i.name),
    ['a', 'b']
  )
  assert.deepEqual(changedFirst([]), [])
})

/* ---------------- 두 묶음 · 보이는 것 ---------------- */

test('바뀐 것과 동일한 것을 두 묶음으로 — 묶음 안 순서는 그대로', () => {
  const { changed, same } = splitSame([item('a', 'same'), item('b', 'added'), item('c', 'same'), item('d', 'modified')])
  assert.deepEqual(
    changed.map((i) => i.name),
    ['b', 'd']
  )
  assert.deepEqual(
    same.map((i) => i.name),
    ['a', 'c']
  )
})

test('보이는 것 — 동일한 것은 펼쳤거나 검색 중일 때만 (고른 항목 맞추기 · 이전/다음 이동이 이것을 따른다)', () => {
  const changed = ['b', 'd']
  const same = ['a', 'c']
  assert.deepEqual(shownItems(changed, same, false, false), ['b', 'd'], '처음은 접혀 있다')
  assert.deepEqual(shownItems(changed, same, true, false), ['b', 'd', 'a', 'c'], '펼치면 아래에 이어진다')
  assert.deepEqual(shownItems(changed, same, false, true), ['b', 'd', 'a', 'c'], '검색 중에는 접혀 있어도 찾는다')
})

/* ---------------- 스키마 테이블 목록 ---------------- */

const HEADERS = [
  '[COLUMN],TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,DATA_SCALE,NULLABLE',
  '[CONSTRAINT],TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE,COLUMN_NAME,TO_CHAR(POSITION)',
  '[INDEX],TABLE_NAME,INDEX_NAME,UNIQUNESS,COLUMN_NAME,TO_CHAR(COLUMN_POSITION)',
].join('\n')
const snap = (...lines: string[]) => parseSchema(`${HEADERS}\n${lines.join('\n')}`, DEFAULT_SCHEMA_CONFIG)

test('"변경된 테이블만" 을 끄면 바뀐 테이블이 위, 동일한 테이블이 아래 (각각 이름순)', () => {
  const tables = compareSchemas(
    snap(
      '[COLUMN],TB_A,X,CHAR,1,,,Y',
      '[COLUMN],TB_B,X,CHAR,1,,,Y',
      '[COLUMN],TB_C,X,CHAR,1,,,Y',
      '[COLUMN],TB_D,X,CHAR,1,,,Y'
    ),
    snap(
      '[COLUMN],TB_A,X,CHAR,1,,,Y',
      '[COLUMN],TB_B,X,CHAR,2,,,Y',
      '[COLUMN],TB_C,X,CHAR,1,,,Y',
      '[COLUMN],TB_D,X,CHAR,9,,,Y'
    )
  )
  const all = filterTables(tables, { query: '', onlyChanged: false, kind: null })
  assert.deepEqual(
    all.map((t) => t.name),
    ['TB_B', 'TB_D', 'TB_A', 'TB_C']
  )
})
