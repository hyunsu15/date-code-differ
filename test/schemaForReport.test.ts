import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadSchemaForReport } from '../src/features/report/schemaForReport.ts'
import { snapshotSortKey } from '../src/lib/fileTypes.ts'
import type { SchemaComparisonResponse, SourceConfig, TableDiff } from '../src/types.ts'

/**
 * 보고서용 스키마를 그 자리에서 읽는 순서 — 날짜 목록 → 날짜 맞추기 → 대조 → 접기.
 *
 * 스키마 탭을 안 열고 눌러도, 열어 본 뒤 환경을 바꾸고 눌러도 화면이 보여줄 것과
 * 같은 날짜·같은 숫자가 나와야 한다. 서버는 바깥 경계라 `fetch` 만 갈아 끼운다.
 */

const SOURCE: SourceConfig = {
  mode: 'local',
  root: './sample-code',
  encoding: 'auto',
  schemaRoot: './sample-schema',
}

const refs = (...ids: string[]) => ids.map((id) => ({ id, sortKey: snapshotSortKey(id) }))

const emptySection = (kind: 'column' | 'constraint' | 'index') => ({
  kind,
  rows: [],
  added: 0,
  removed: 0,
  modified: 0,
  total: 0,
  systemHidden: 0,
  excludedHidden: 0,
  excludedChanged: 0,
})

const table = (name: string): TableDiff => ({
  name,
  status: 'same',
  sections: {
    column: emptySection('column'),
    constraint: emptySection('constraint'),
    index: emptySection('index'),
  },
  primaryKeyChanged: false,
  changedKinds: [],
})

interface Server {
  list: { left: ReturnType<typeof refs>; right: ReturnType<typeof refs> }
  tables: TableDiff[]
  rules: string[]
}

let server: Server
/** 대조 요청에 실려 간 날짜 */
let asked: { left: string | null; right: string | null }

beforeEach(() => {
  server = { list: { left: refs(), right: refs() }, tables: [], rules: [] }
  asked = { left: null, right: null }

  ;(globalThis as { window?: unknown }).window = { location: { origin: 'http://localhost' } }
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/schemas/snapshots')) {
      return Response.json({ root: '', ...server.list })
    }
    asked = { left: url.searchParams.get('left'), right: url.searchParams.get('right') }
    const body: SchemaComparisonResponse = {
      left: asked.left ?? '',
      right: asked.right ?? '',
      leftDescription: '',
      rightDescription: '',
      tables: server.tables,
      malformed: 0,
      malformedSample: [],
      malformedHint: '',
      exclude: { file: '', rules: server.rules, error: null },
    }
    return Response.json(body)
  }) as typeof fetch
})

const args = (over: Partial<Parameters<typeof loadSchemaForReport>[0]> = {}) => ({
  source: SOURCE,
  leftEnv: 'prod',
  rightEnv: 'test',
  sameSource: false,
  codeLeft: '2026-09-01',
  codeRight: '2026-09-01',
  myExclude: '',
  ...over,
})

test('소스 날짜에 가장 가까운 덤프로 맞춘다 — 앞이든 뒤든', async () => {
  server.list = { left: refs('2026-09-03', '2026-08-01'), right: refs('2026-08-20', '2026-07-01') }
  const res = await loadSchemaForReport(args())
  // 왼쪽: 9/1 에서 이틀 뒤가 한 달 전보다 가깝다. 오른쪽: 12일 전이 두 달 전보다 가깝다
  assert.deepEqual(asked, { left: '2026-09-03', right: '2026-08-20' })
  assert.deepEqual([res?.left, res?.right], ['2026-09-03', '2026-08-20'])
})

test('같은 환경에서 두 날짜가 같은 덤프로 맞춰지면 견주지 않고 sameDump 로 알린다', async () => {
  // 소스 6/1 → 7/1 인데 덤프가 8/1 · 9/1 뿐이다. 예전에는 오른쪽을 9/1 로 밀어
  // 7월 소스 비교에 9월 스키마 변경이 실렸다
  server.list = { left: refs('2026-09-01', '2026-08-01'), right: refs('2026-09-01', '2026-08-01') }
  const res = await loadSchemaForReport(
    args({ rightEnv: 'prod', sameSource: true, codeLeft: '2026-06-01', codeRight: '2026-07-01' })
  )
  assert.deepEqual(res, { left: '2026-08-01', right: '2026-08-01', tables: [], sameDump: true })
  assert.deepEqual(asked, { left: null, right: null }, '같은 파일끼리 대조를 묻지 않는다')
})

test('같은 환경에서 서로 다른 덤프로 맞춰지면 그대로 견준다 — 순서를 억지로 바꾸지 않는다', async () => {
  server.list = { left: refs('2026-09-01', '2026-08-01'), right: refs('2026-09-01', '2026-08-01') }
  const res = await loadSchemaForReport(
    args({ rightEnv: 'prod', sameSource: true, codeLeft: '2026-08-01', codeRight: '2026-09-01' })
  )
  assert.deepEqual(asked, { left: '2026-08-01', right: '2026-09-01' })
  assert.equal(res?.sameDump, false)
})

test('pinned 면 맞추지 않고 그 덤프 그대로 — 스키마 탭에서 보고 있는 것을 받을 때', async () => {
  // 목록을 묻지도 않는다: 화면이 이미 고른 날짜다
  let listed = false
  const real = globalThis.fetch
  globalThis.fetch = (async (input: URL | string) => {
    if (String(input).includes('/schemas/snapshots')) listed = true
    return real(input)
  }) as typeof fetch
  server.list = { left: refs('2026-09-01', '2026-08-01'), right: refs('2026-09-01', '2026-08-01') }
  const res = await loadSchemaForReport(
    args({
      rightEnv: 'prod',
      sameSource: true,
      codeLeft: '2026-06-01',
      codeRight: '2026-07-01',
      pinned: { left: '2026-08-01', right: '2026-09-01' },
    })
  )
  assert.equal(listed, false)
  assert.deepEqual(asked, { left: '2026-08-01', right: '2026-09-01' })
  assert.equal(res?.sameDump, false, '소스 날짜(6/1 → 7/1)로는 같은 덤프였겠지만 pinned 가 우선이다')
})

test('환경이 다르면 같은 날짜의 덤프여도 견준다 — 다른 파일이다', async () => {
  server.list = { left: refs('2026-09-01'), right: refs('2026-09-01') }
  const res = await loadSchemaForReport(args())
  assert.deepEqual(asked, { left: '2026-09-01', right: '2026-09-01' })
  assert.equal(res?.sameDump, false)
})

test('그 환경에 덤프가 없으면 null — 대조를 묻지 않는다', async () => {
  server.list = { left: refs('2026-09-01'), right: refs() }
  assert.equal(await loadSchemaForReport(args()), null)
  assert.deepEqual(asked, { left: null, right: null })
})

test('팀 규칙과 내 목록에 걸린 테이블은 빠진다 — 화면 숫자와 같아야 한다', async () => {
  server.list = { left: refs('2026-09-01'), right: refs('2026-09-01') }
  server.tables = [table('TB_ORD'), table('TB_TMP_LOG'), table('TB_BAK_ORD')]
  server.rules = ['TB_TMP_*']
  const res = await loadSchemaForReport(args({ myExclude: 'TB_BAK_*' }))
  assert.deepEqual(
    res?.tables.map((t) => t.name),
    ['TB_ORD']
  )
})

test('서버가 실패하면 그대로 던진다 — 부르는 쪽이 "빠졌다" 고 알린다', async () => {
  globalThis.fetch = (async () =>
    Response.json({ code: 'SCHEMA_ROOT', message: '스키마 폴더가 없습니다' }, { status: 404 })) as typeof fetch
  await assert.rejects(loadSchemaForReport(args()), /스키마 폴더가 없습니다/)
})
