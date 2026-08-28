import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { clearCache, listSnapshots, readRepositoryConfig } from '../server/snapshotRepository.ts'
import { createSource, sourceKey } from '../server/source/resolve.ts'
import type { SourceConfig } from '../src/types.ts'

/**
 * 날짜 폴더명이 `yyyyMMdd` 처럼 구분자 없이 와도 정렬이 맞는지
 * **실제 폴더**를 만들어 확인한다. (fs 는 외부 경계라 mock 하지 않는다)
 */

let root = ''

const cfg = readRepositoryConfig()

/** 임시 폴더를 로컬 소스로 감싼다 */
function open(dir: string) {
  const config: SourceConfig = { mode: 'local', root: dir, encoding: 'auto' }
  return {
    source: createSource(config, process.cwd()),
    key: sourceKey(config, process.cwd()),
  }
}

/** 폴더 하나를 만들고 비교 대상 파일 하나를 넣는다 */
async function makeSnapshot(name: string, body: string): Promise<void> {
  const dir = path.join(root, name, 'ord')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'ord_create.pc'), body, 'utf8')
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'code-diff-naming-'))
})

after(async () => {
  clearCache() // 다른 테스트 파일과 캐시를 공유하지 않도록 비운다
  await fs.rm(root, { recursive: true, force: true })
})

test('구분자 없는 yyyyMMdd 폴더도 최신순으로 정렬된다', async () => {
  await makeSnapshot('20260601', 'int a = 1;\n')
  await makeSnapshot('20260701', 'int a = 2;\n')
  await makeSnapshot('20260801', 'int a = 3;\n')

  clearCache()
  const { source, key } = open(root)
  const items = await listSnapshots(source, cfg, key)

  assert.deepEqual(
    items.map((s) => s.id),
    ['20260801', '20260701', '20260601']
  )
  assert.deepEqual(
    items.map((s) => s.sortKey),
    ['20260801', '20260701', '20260601']
  )
  assert.ok(items.every((s) => s.fileCount === 1))
})

test('표기법이 섞여 있어도 날짜 기준으로 함께 정렬된다', async () => {
  await fs.rm(root, { recursive: true, force: true })
  await makeSnapshot('20260601', 'x\n') // 구분자 없음
  await makeSnapshot('2026-07-01', 'x\n') // 하이픈
  await makeSnapshot('rel_20260901', 'x\n') // 접두어 + 구분자 없음
  await makeSnapshot('v2_20260801', 'x\n') // 앞에 숫자가 낀 접두어

  clearCache()
  const { source, key } = open(root)
  const items = await listSnapshots(source, cfg, key)

  assert.deepEqual(
    items.map((s) => s.id),
    ['rel_20260901', 'v2_20260801', '2026-07-01', '20260601']
  )
})

test('날짜가 아닌 폴더는 날짜 폴더 뒤로 밀린다', async () => {
  await fs.rm(root, { recursive: true, force: true })
  await makeSnapshot('20260801', 'x\n')
  await makeSnapshot('trunk', 'x\n')
  await makeSnapshot('20260601', 'x\n')
  await makeSnapshot('backup', 'x\n')

  clearCache()
  const { source, key } = open(root)
  const items = await listSnapshots(source, cfg, key)

  assert.deepEqual(
    items.map((s) => s.id),
    ['20260801', '20260601', 'trunk', 'backup'] // 날짜 최신순 → 이름 역순
  )
  assert.deepEqual(
    items.map((s) => s.sortKey),
    ['20260801', '20260601', '', '']
  )
})

test('연·월이 걸쳐 있어도 날짜순이 맞는다', async () => {
  await fs.rm(root, { recursive: true, force: true })
  for (const name of ['20251231', '20260101', '20260201', '20251130']) {
    await makeSnapshot(name, 'x\n')
  }

  clearCache()
  const { source, key } = open(root)
  const items = await listSnapshots(source, cfg, key)

  assert.deepEqual(
    items.map((s) => s.id),
    ['20260201', '20260101', '20251231', '20251130']
  )
})
