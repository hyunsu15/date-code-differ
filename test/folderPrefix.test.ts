import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  clearCache,
  listSnapshots,
  matchesPrefix,
  readRepositoryConfig,
} from '../server/snapshotRepository.ts'
import { createSource, sourceKey } from '../server/source/resolve.ts'
import {
  ALL_PREFIX,
  defaultPrefixId,
  FOLDER_PREFIXES,
  parsePrefixId,
  prefixById,
  PREFIX_CHOICES,
  prefixValue,
} from '../src/features/settings/folderPrefix.ts'
import { ALL_PREFIXES_ID, type SourceConfig } from '../src/types.ts'

/**
 * 한 폴더에 환경별 스냅샷이 섞여 있을 때(`prod_20260801` · `test_20260801`)
 * 고른 접두사로만 목록이 좁혀지는지 확인한다.
 *
 * 거르는 일은 **서버**가 한다 — 스냅샷마다 파일을 훑는 게 비싼 쪽이라
 * 훑기 전에 걸러야 하기 때문이다.
 */

/* ---------------- 접두사 판정 ---------------- */

test('접두사로 시작하면 통과한다', () => {
  assert.ok(matchesPrefix('prod_20260801', 'prod'))
  assert.ok(matchesPrefix('prod-20260801', 'prod'))
  assert.ok(matchesPrefix('prod20260801', 'prod'))
  assert.ok(matchesPrefix('prod_20260801', 'prod_'))
})

test('접두사가 비면 전부 통과한다 (전체 보기)', () => {
  assert.ok(matchesPrefix('20260801', ''))
  assert.ok(matchesPrefix('trunk', '   '))
})

test('대소문자는 구분하지 않는다 — 서버마다 표기가 다르다', () => {
  assert.ok(matchesPrefix('PROD_20260801', 'prod'))
  assert.ok(matchesPrefix('prod_20260801', 'PROD'))
})

test('중간에 있는 글자는 잡지 않는다 — 접두사다', () => {
  assert.equal(matchesPrefix('rel_prod_20260801', 'prod'), false)
  assert.equal(matchesPrefix('test_20260801', 'prod'), false)
})

/* ---------------- 실제 폴더로 거르기 ---------------- */

let root = ''
const cfg = readRepositoryConfig()

function open(dir: string) {
  const config: SourceConfig = { mode: 'local', root: dir, encoding: 'auto' }
  return { source: createSource(config, process.cwd()), key: sourceKey(config, process.cwd()) }
}

async function makeSnapshot(name: string): Promise<void> {
  const dir = path.join(root, name, 'ord')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'ord_create.pc'), 'int a = 1;\n', 'utf8')
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'code-diff-prefix-'))
  for (const name of [
    'prod_20260801',
    'prod_20260901',
    'test_20260801',
    'dev_20260901',
    '20260601',
  ]) {
    await makeSnapshot(name)
  }
})

after(async () => {
  clearCache() // 다른 테스트 파일과 캐시를 공유하지 않도록 비운다
  await fs.rm(root, { recursive: true, force: true })
})

test('접두사를 고르면 그 폴더만 최신순으로 남는다', async () => {
  clearCache()
  const { source, key } = open(root)
  const items = await listSnapshots(source, cfg, key, 'prod')

  assert.deepEqual(
    items.map((s) => s.id),
    ['prod_20260901', 'prod_20260801']
  )
})

test('접두사를 비우면 전부 나온다 (지금까지의 동작)', async () => {
  clearCache()
  const { source, key } = open(root)
  const items = await listSnapshots(source, cfg, key)

  assert.equal(items.length, 5)
  assert.deepEqual(await listSnapshots(source, cfg, key, ''), items)
})

test('맞는 폴더가 하나도 없으면 빈 목록이다 (오류가 아니다)', async () => {
  clearCache()
  const { source, key } = open(root)
  assert.deepEqual(await listSnapshots(source, cfg, key, 'stage'), [])
})

test('걸러진 폴더도 파일 수·정렬키는 그대로 계산된다', async () => {
  clearCache()
  const { source, key } = open(root)
  const [latest] = await listSnapshots(source, cfg, key, 'dev')

  assert.equal(latest?.id, 'dev_20260901')
  assert.equal(latest?.sortKey, '20260901')
  assert.equal(latest?.fileCount, 1)
  assert.equal(latest?.packageCount, 1)
})

/* ---------------- 화면 쪽 선택 ---------------- */

test('고를 목록의 맨 앞은 전체 보기다', () => {
  assert.equal(PREFIX_CHOICES[0], ALL_PREFIX)
  assert.equal(PREFIX_CHOICES.length, FOLDER_PREFIXES.length + 1)
})

test('템플릿에는 운영·테스트·개발이 있다', () => {
  assert.deepEqual(
    FOLDER_PREFIXES.map((p) => p.id),
    ['prod', 'test', 'dev']
  )
})

test('접두사 id 는 서로 겹치지 않는다 (겹치면 선택이 어긋난다)', () => {
  const ids = PREFIX_CHOICES.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('없는 id 는 전체 보기로 떨어진다 — 설정에서 항목을 지운 경우', () => {
  assert.equal(prefixById('없는id').id, ALL_PREFIXES_ID)
  assert.equal(parsePrefixId('없는id'), ALL_PREFIXES_ID)
  assert.equal(prefixValue('없는id'), '')
})

test('저장된 게 없으면 DEFAULT_PREFIX_ID 를 쓴다', () => {
  assert.equal(parsePrefixId(null), defaultPrefixId())
  assert.equal(parsePrefixId(''), defaultPrefixId())
})

test('전체 보기는 거르지 않는다 (빈 접두사)', () => {
  assert.equal(prefixValue(ALL_PREFIXES_ID), '')
  assert.ok(matchesPrefix('무엇이든', prefixValue(ALL_PREFIXES_ID)))
})

test('고른 접두사는 실제로 거를 문자열을 돌려준다', () => {
  assert.equal(prefixValue('prod'), 'prod')
  assert.ok(matchesPrefix('prod_20260801', prefixValue('prod')))
  assert.equal(matchesPrefix('test_20260801', prefixValue('prod')), false)
})
