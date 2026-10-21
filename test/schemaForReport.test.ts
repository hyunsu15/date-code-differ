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
  picked: { left: '', right: '' },
  codeLeft: '2026-09-01',
  codeRight: '2026-09-01',
  myExclude: '',
  ...over,
})

test('스키마 탭을 안 열었으면 코드 날짜에 맞춘다 — 그 시점에 걸려 있던 덤프', async () => {
  server.list = { left: refs('2026-09-01', '2026-08-01'), right: refs('2026-08-20', '2026-07-01') }
  const res = await loadSchemaForReport(args())
  assert.deepEqual(asked, { left: '2026-09-01', right: '2026-08-20' })
  assert.equal(res?.right, '2026-08-20')
})

test('스키마 탭에서 고른 날짜가 있으면 그것을 쓴다', async () => {
  server.list = { left: refs('2026-09-01', '2026-08-01'), right: refs('2026-09-01', '2026-08-01') }
  await loadSchemaForReport(args({ picked: { left: '2026-08-01', right: '2026-08-01' } }))
  assert.deepEqual(asked, { left: '2026-08-01', right: '2026-08-01' })
})

test('고른 날짜가 새 환경 목록에 없으면 바로잡는다 — 탭을 본 뒤 환경을 바꾼 경우', async () => {
  server.list = { left: refs('2026-09-01'), right: refs('2026-09-01') }
  await loadSchemaForReport(args({ picked: { left: '2026-05-01', right: '2026-05-01' } }))
  assert.deepEqual(asked, { left: '2026-09-01', right: '2026-09-01' })
})

test('같은 환경이면 오른쪽이 왼쪽보다 최신이 되게 맞춘다', async () => {
  server.list = { left: refs('2026-09-01', '2026-08-01'), right: refs('2026-09-01', '2026-08-01') }
  await loadSchemaForReport(args({ rightEnv: 'prod', sameSource: true }))
  assert.deepEqual(asked, { left: '2026-08-01', right: '2026-09-01' })
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
