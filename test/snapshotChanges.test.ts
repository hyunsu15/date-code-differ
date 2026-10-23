import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ExcludeList } from '../src/lib/excludeList.ts'
import { clearCache, readRepositoryConfig, type SnapshotFile } from '../server/snapshotRepository.ts'
import {
  clearChangeCache,
  countChanges,
  diffLists,
  listSnapshotChanges,
} from '../server/snapshotChanges.ts'
import { createSource, sourceKey } from '../server/source/resolve.ts'
import type { SourceConfig } from '../src/types.ts'

/**
 * 날짜마다 바로 앞 날짜 대비 변경 수 — 날짜 고르기 목록의 "변경 N개" 와 "변경된 날짜만" 이 이걸 본다.
 *
 * 핵심은 **배포가 없던 날(앞 날짜와 똑같은 폴더)을 0 으로** 세는 것이다. 그게 틀리면
 * "변경된 날짜만" 이 아무것도 거르지 못하거나, 진짜 배포일을 숨긴다.
 */

const f = (p: string, size: number, checksum: string | null = null): SnapshotFile => ({
  path: p,
  name: p.split('/').pop() ?? p,
  packageName: p.split('/')[0],
  size,
  checksum,
})

/* ---------------- 목록 견주기 (순수) ---------------- */

test('새로 생긴 · 없어진 · 크기가 바뀐 파일을 가른다', () => {
  const d = diffLists([f('a/x.pc', 10), f('a/y.pc', 10)], [f('a/x.pc', 12), f('a/z.pc', 3)])
  assert.deepEqual(d.added, ['a/z.pc'])
  assert.deepEqual(d.removed, ['a/y.pc'])
  assert.deepEqual(d.modified, ['a/x.pc'])
  assert.deepEqual(d.unsure, [])
})

test('크기가 같으면 체크섬으로 가른다 — SSH 는 본문을 읽지 않는다', () => {
  const d = diffLists(
    [f('a/same.pc', 5, 'C1:5'), f('a/diff.pc', 5, 'C2:5')],
    [f('a/same.pc', 5, 'C1:5'), f('a/diff.pc', 5, 'C9:5')]
  )
  assert.deepEqual(d.modified, ['a/diff.pc'])
  assert.deepEqual(d.unsure, [])
})

test('크기가 같고 체크섬이 없으면(로컬) 본문을 봐야 한다고 넘긴다', () => {
  const d = diffLists([f('a/x.pc', 5)], [f('a/x.pc', 5)])
  assert.deepEqual(d.unsure, ['a/x.pc'])
  assert.deepEqual(d.modified, [])
})

test('팀 제외 목록에 걸린 파일은 세지 않는다 — 늘 바뀌는 임시 파일로 모든 날짜가 변경이 되지 않게', () => {
  const exclude = ExcludeList.parse('*_tmp.pc')
  const c = countChanges(
    { added: ['a/new.pc', 'a/x_tmp.pc'], removed: [], modified: ['a/y_tmp.pc'] },
    exclude,
    '20260901',
    '20260801'
  )
  assert.deepEqual(c, { id: '20260901', base: '20260801', added: 1, removed: 0, modified: 0 })
})

/* ---------------- 실제 폴더로 (로컬 — 체크섬 없음) ---------------- */

let root = ''
const cfg = readRepositoryConfig()

const open = () => {
  const config: SourceConfig = { mode: 'local', root, encoding: 'auto' }
  return { source: createSource(config, process.cwd()), key: sourceKey(config, process.cwd()) }
}

async function write(day: string, rel: string, text: string): Promise<void> {
  const file = path.join(root, day, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text, 'utf8')
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'code-diff-changes-'))
  // 08-01: 처음
  await write('20260801', 'ord/ord_create.pc', 'int a = 1;\n')
  await write('20260801', 'ord/ord_cancel.pc', 'int b = 2;\n')
  // 08-15: 배포 없던 날 — 08-01 과 똑같이 복사된 폴더
  await write('20260815', 'ord/ord_create.pc', 'int a = 1;\n')
  await write('20260815', 'ord/ord_cancel.pc', 'int b = 2;\n')
  // 09-01: 크기는 같고 내용만 다른 수정 1 + 새 파일 1 + 삭제 1
  await write('20260901', 'ord/ord_create.pc', 'int a = 7;\n')
  await write('20260901', 'pay/pay_new.pc', 'int c;\n')
})

after(async () => {
  clearCache()
  clearChangeCache()
  await fs.rm(root, { recursive: true, force: true })
})

test('날짜마다 바로 앞 날짜 대비 — 배포 없던 날은 0, 크기가 같아도 내용이 다르면 변경', async () => {
  clearCache()
  clearChangeCache()
  const { source, key } = open()
  const items = await listSnapshotChanges(source, cfg, key, ExcludeList.EMPTY)
  assert.deepEqual(items, [
    { id: '20260901', base: '20260815', added: 1, removed: 1, modified: 1 },
    { id: '20260815', base: '20260801', added: 0, removed: 0, modified: 0 },
    { id: '20260801', base: null, added: 2, removed: 0, modified: 0 },
  ])
})

test('제외 목록은 캐시와 상관없이 매번 얹힌다 — 규칙을 바꾸면 수가 바로 바뀐다', async () => {
  const { source, key } = open()
  const items = await listSnapshotChanges(source, cfg, key, ExcludeList.parse('pay'))
  assert.deepEqual(items[0], { id: '20260901', base: '20260815', added: 0, removed: 1, modified: 1 })
})
