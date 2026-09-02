import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyLocalExclude, toggleLocalExclude } from '../src/features/settings/localExclude.ts'
import type { ComparedFile, DiffStats } from '../src/types.ts'

/**
 * 내 제외 목록 — 화면에서 바로 접고 이 브라우저에만 남는 목록.
 *
 * 판정 규칙 자체는 `excludeList.test.ts` 가 다룬다. 여기서는 **서버가 접은 것 위에
 * 얹는 일**과 **목록에서 한 번 눌러 접고 펴는 일**만 본다.
 */

const STATS = { added: 0, removed: 0, modified: 0 } as unknown as DiffStats

const file = (path: string, over: Partial<ComparedFile> = {}): ComparedFile => ({
  path,
  name: path.split('/').pop() ?? path,
  packageName: path.split('/')[0] ?? '',
  status: 'modified',
  stats: STATS,
  leftSize: 1,
  rightSize: 1,
  excluded: false,
  excludedBy: null,
  ...over,
})

/* ---------------- 얹기 ---------------- */

test('내 목록에 걸린 파일을 접고 어느 목록 때문인지 남긴다', () => {
  const out = applyLocalExclude([file('ord/ord_bak.pc'), file('ord/ord_create.pc')], '*_bak.pc')
  assert.equal(out.files[0].excluded, true)
  assert.equal(out.files[0].excludedBy, '*_bak.pc')
  assert.equal(out.files[0].excludedLocal, true)
  assert.equal(out.files[1].excluded, false)
})

test('서버가 이미 접은 것은 그대로 둔다 — 규칙 파일 쪽 표시가 지워지면 안 된다', () => {
  const already = file('ord/gen.pc', { excluded: true, excludedBy: '*_gen.pc' })
  const out = applyLocalExclude([already], 'ord')
  assert.equal(out.files[0].excludedBy, '*_gen.pc')
  assert.equal(out.files[0].excludedLocal, undefined)
})

test('두 목록이 같은 파일을 가리켜도 한 번만 센다', () => {
  const out = applyLocalExclude(
    [file('a.pc', { excluded: true, excludedBy: 'a.pc' }), file('b.pc')],
    'a.pc\nb.pc'
  )
  assert.equal(out.excluded, 2)
  assert.equal(out.byMine, 1)
})

test('접은 것 중 바뀐 파일 수를 따로 센다 — 접어 둔 자리의 변경을 알려야 한다', () => {
  const out = applyLocalExclude(
    [file('a.pc'), file('b.pc', { status: 'same' })],
    'a.pc\nb.pc'
  )
  assert.equal(out.excluded, 2)
  assert.equal(out.excludedChanged, 1)
})

test('목록이 비면 아무것도 안 바뀐다', () => {
  const files = [file('a.pc')]
  const out = applyLocalExclude(files, '')
  assert.equal(out.excluded, 0)
  assert.deepEqual(out.files[0], files[0])
})

/* ---------------- 넣고 빼기 ---------------- */

test('없으면 넣는다', () => {
  assert.equal(toggleLocalExclude('', 'ord/a.pc'), 'ord/a.pc')
  assert.equal(toggleLocalExclude('x.pc', 'ord/a.pc'), 'x.pc\nord/a.pc')
})

test('있으면 뺀다', () => {
  assert.equal(toggleLocalExclude('ord/a.pc', 'ord/a.pc'), '')
  assert.equal(toggleLocalExclude('x.pc\nord/a.pc', 'ord/a.pc'), 'x.pc')
})

test('글로브에 걸려 접힌 파일은 그 글로브를 뺀다 — 경로만 지우면 버튼이 고장 난 것처럼 보인다', () => {
  const next = toggleLocalExclude('*_common.h', 'ord/ord_common.h')
  assert.equal(next, '')
  assert.equal(applyLocalExclude([file('ord/ord_common.h')], next).excluded, 0)
})

test('쉼표로 이어 적은 줄에서도 조각 하나만 뺀다', () => {
  assert.equal(toggleLocalExclude('a.pc,b.pc', 'b.pc'), 'a.pc')
})

test('넣고 다시 누르면 원래대로 돌아온다', () => {
  const path = 'ord/ord_create.pc'
  const added = toggleLocalExclude('tmp', path)
  assert.equal(applyLocalExclude([file(path)], added).excluded, 1)
  assert.equal(applyLocalExclude([file(path)], toggleLocalExclude(added, path)).excluded, 0)
})
