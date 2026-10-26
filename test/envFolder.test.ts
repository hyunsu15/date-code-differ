import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { clearCache, listSnapshots, readRepositoryConfig } from '../server/snapshotRepository.ts'
import { createSource, sourceKey } from '../server/source/resolve.ts'
import { listDirsCommand } from '../server/source/sshCommands.ts'
import {
  defaultEnvId,
  defaultEnvPair,
  ENV_CHOICES,
  ENV_FOLDERS,
  envById,
  envColorClass,
  envPath,
  joinRoot,
  linkEnvPair,
  parseEnvId,
  parseEnvLinked,
  parseEnvPair,
  pickEnv,
  withEnv,
} from '../src/features/settings/envFolder.ts'
import type { SourceConfig } from '../src/types.ts'

/**
 * 환경이 루트 아래 폴더로 나뉘어 있을 때(`release/prod/20260801` · `release/test/20260801`)
 * 고른 환경의 폴더만 목록에 나오는지 확인한다.
 *
 * 거르는 게 아니라 **루트를 바꾸는** 방식이다 — 화면이 `root + '/prod'` 를 보내고
 * 서버는 그냥 그 폴더를 읽는다. 그래서 서버에는 환경이라는 개념이 없다.
 */

/* ---------------- 경로 잇기 ---------------- */

test('루트 뒤에 환경 폴더를 붙인다', () => {
  assert.equal(joinRoot('/home/deploy/release', 'prod'), '/home/deploy/release/prod')
})

test('구분자가 겹치거나 빠져도 하나로 맞춘다', () => {
  assert.equal(joinRoot('/home/deploy/release/', 'prod'), '/home/deploy/release/prod')
  assert.equal(joinRoot('/home/deploy/release', '/prod/'), '/home/deploy/release/prod')
})

test('여러 단도 붙는다 — 환경 아래 또 나뉜 경우', () => {
  assert.equal(joinRoot('/srv/release', 'rel/qa'), '/srv/release/rel/qa')
})

test('홈 기준 경로(~)는 앞을 건드리지 않는다 — 원격 셸이 확장해야 한다', () => {
  assert.equal(joinRoot('~/release', 'prod'), '~/release/prod')
})

test('윈도우 경로는 앞을 그대로 두고 뒤만 이어 붙인다 — 서버가 path.resolve 로 푼다', () => {
  assert.equal(joinRoot('D:\\release', 'prod'), 'D:\\release/prod')
  assert.equal(joinRoot('D:\\release\\', 'prod'), 'D:\\release/prod')
  assert.equal(joinRoot('D:/release', 'prod'), 'D:/release/prod')
})

test('환경을 안 고르면 위치 객체를 그대로 돌려준다 — 동일성으로 목록 출처를 가린다', () => {
  const source: SourceConfig = { mode: 'local', root: './sample-code', encoding: 'auto' }
  assert.equal(withEnv(source, ''), source)
  assert.equal(withEnv(source, '   '), source)
})

const SSH: SourceConfig = {
  mode: 'ssh',
  host: 'dev-server',
  port: null,
  user: 'deploy',
  identityFile: '',
  root: '/home/deploy/release',
  encoding: 'euc-kr',
}

test('환경을 고르면 루트만 바뀐 새 위치가 나온다', () => {
  assert.deepEqual(withEnv(SSH, 'prod'), { ...SSH, root: '/home/deploy/release/prod' })
})

/**
 * 로컬·SSH 를 가리지 않는다 — `withEnv` 는 `mode` 를 보지 않고 `root` 만 바꾼다.
 * 원격은 그 경로가 **셸 명령에 박혀 나가므로** 실제 명령까지 확인한다.
 */
test('SSH 도 같은 규칙으로 내려간다 — 원격 명령이 환경 폴더를 가리킨다', () => {
  assert.equal(
    listDirsCommand(withEnv(SSH, 'prod').root),
    "ls -1F -- '/home/deploy/release/prod'"
  )
})

test('홈 기준(~) 원격 경로는 틸드가 따옴표 밖에 남는다 — 원격 셸이 확장해야 한다', () => {
  assert.equal(
    listDirsCommand(withEnv({ ...SSH, root: '~/release' }, 'prod').root),
    "ls -1F -- ~/'release/prod'"
  )
})

/* ---------------- 실제 폴더로 확인 ---------------- */

let root = ''
const cfg = readRepositoryConfig()

function open(dir: string) {
  const config: SourceConfig = { mode: 'local', root: dir, encoding: 'auto' }
  return { source: createSource(config, process.cwd()), key: sourceKey(config, process.cwd()) }
}

/** `<root>/<env>/<날짜>/ord/ord_create.pc` 를 만든다 */
async function makeSnapshot(env: string, day: string): Promise<void> {
  const dir = path.join(root, env, day, 'ord')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'ord_create.pc'), 'int a = 1;\n', 'utf8')
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'code-diff-env-'))
  await makeSnapshot('prod', '20260801')
  await makeSnapshot('prod', '20260901')
  await makeSnapshot('test', '20260801')
  await makeSnapshot('dev', '20260901')
})

after(async () => {
  clearCache() // 다른 테스트 파일과 캐시를 공유하지 않도록 비운다
  await fs.rm(root, { recursive: true, force: true })
})

test('운영을 고르면 운영 폴더의 날짜만 최신순으로 나온다', async () => {
  clearCache()
  const { source, key } = open(joinRoot(root, 'prod'))
  const items = await listSnapshots(source, cfg, key)

  assert.deepEqual(
    items.map((s) => s.id),
    ['20260901', '20260801']
  )
})

test('테스트를 고르면 테스트 폴더만 본다 — 운영과 날짜가 같아도 섞이지 않는다', async () => {
  clearCache()
  const { source, key } = open(joinRoot(root, 'test'))
  const items = await listSnapshots(source, cfg, key)

  assert.deepEqual(
    items.map((s) => s.id),
    ['20260801']
  )
})

test('환경 폴더 안의 파일 수·정렬키도 그대로 계산된다', async () => {
  clearCache()
  const { source, key } = open(joinRoot(root, 'dev'))
  const [latest] = await listSnapshots(source, cfg, key)

  assert.equal(latest?.id, '20260901')
  assert.equal(latest?.sortKey, '20260901')
  assert.equal(latest?.fileCount, 1)
  assert.equal(latest?.packageCount, 1)
})

/**
 * 화면이 루트를 고를 수 없게 만든 이유를 못으로 박아 둔다.
 * 환경 폴더를 쓰는 배치에서 루트를 읽으면 이렇게 **날짜가 아닌 것**이 목록에 올라온다 —
 * 그대로 두면 이전/이후 칸이 `prod` `test` `dev` 로 채워진다.
 */
test('루트를 읽으면 날짜가 아니라 환경 폴더가 목록에 올라온다 — 그래서 고를 수 없게 뒀다', async () => {
  clearCache()
  const { source, key } = open(root)
  const items = await listSnapshots(source, cfg, key)

  assert.deepEqual(
    items.map((s) => s.id).sort(),
    ['dev', 'prod', 'test']
  )
  assert.deepEqual(
    items.map((s) => s.sortKey),
    ['', '', ''],
    '날짜로 읽히지 않는다'
  )
})

test('없는 환경 폴더는 오류로 알린다 — 조용히 빈 목록이면 원인을 못 찾는다', async () => {
  clearCache()
  const { source, key } = open(joinRoot(root, 'stage'))
  await assert.rejects(listSnapshots(source, cfg, key), { code: 'ROOT_NOT_FOUND' })
})

/* ---------------- 화면 쪽 선택 ---------------- */

/* ---------------- 화면 쪽 선택 ---------------- */

/**
 * 목록은 `change/config.ts` 에서 온다 — 그 파일은 커밋되지 않아 사람마다 다르다.
 * 그래서 내용이 아니라 **규칙**만 확인한다.
 */

test('고를 목록은 설정에 적힌 그대로다 — "루트를 그대로" 같은 항목을 끼워 넣지 않는다', () => {
  assert.deepEqual(ENV_CHOICES, ENV_FOLDERS)
  for (const choice of ENV_CHOICES) {
    assert.ok(choice.path.trim(), `${choice.id}: 경로가 빈 항목은 걸러진다`)
  }
})

test('환경 id 는 서로 겹치지 않는다 (겹치면 선택이 어긋난다)', () => {
  const ids = ENV_CHOICES.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('없는 id 는 첫 항목으로 떨어진다 — 설정에서 그 항목을 지운 경우', () => {
  if (ENV_FOLDERS.length === 0) return // 환경을 쓰지 않는 설정
  assert.equal(envById('없는id').id, ENV_FOLDERS[0]?.id)
  assert.equal(parseEnvId('없는id'), ENV_FOLDERS[0]?.id)
})

test('저장된 게 없으면 DEFAULT_ENV_ID 를 쓴다', () => {
  assert.equal(parseEnvId(null), defaultEnvId())
  assert.equal(parseEnvId(''), defaultEnvId())
})

test('기본 환경도 반드시 실제 항목이다 — 첫 화면이 루트를 읽는 일은 없다', () => {
  if (ENV_FOLDERS.length === 0) {
    assert.equal(envPath(defaultEnvId()), '', '환경을 안 쓰면 루트를 그대로 읽는다')
    return
  }
  assert.ok(
    ENV_FOLDERS.some((e) => e.id === defaultEnvId()),
    'DEFAULT_ENV_ID 가 목록에 없어도 첫 항목으로 떨어져야 한다'
  )
  assert.ok(envPath(defaultEnvId()), '기본 환경의 경로는 비어 있지 않다')
})

/* ---------------- 좌우 기본 선택 ---------------- */

test('처음 열면 좌우가 다른 환경을 본다 — 운영 ↔ 테스트', () => {
  const pair = defaultEnvPair()
  assert.equal(pair.left, defaultEnvId(), '왼쪽은 DEFAULT_ENV_ID')
  if (ENV_FOLDERS.length < 2) {
    assert.equal(pair.right, pair.left, '환경이 하나뿐이면 양쪽이 같다')
    return
  }
  assert.notEqual(pair.right, pair.left)
  assert.ok(
    ENV_FOLDERS.some((e) => e.id === pair.right),
    '오른쪽도 실제 항목이어야 한다'
  )
})

test('저장된 게 없으면 좌우 기본 선택으로 연다', () => {
  assert.deepEqual(parseEnvPair(null), defaultEnvPair())
  assert.deepEqual(parseEnvPair(''), defaultEnvPair())
  assert.deepEqual(parseEnvPair('{'), defaultEnvPair(), 'JSON 이 아니면 통째로 기본값')
})

test('저장된 좌우 선택을 그대로 되살린다', () => {
  if (ENV_FOLDERS.length < 2) return
  const [first, second] = ENV_FOLDERS
  const saved = JSON.stringify({ left: second.id, right: first.id })
  assert.deepEqual(parseEnvPair(saved), { left: second.id, right: first.id })
})

test('한쪽만 적혀 있으면 나머지는 기본값으로 채운다', () => {
  if (ENV_FOLDERS.length < 2) return
  const pair = parseEnvPair(JSON.stringify({ left: ENV_FOLDERS[1].id }))
  assert.equal(pair.left, ENV_FOLDERS[1].id)
  assert.equal(pair.right, defaultEnvPair().right)
})

test('예전 저장값(환경 하나)은 양쪽 다 그 환경으로 읽는다', () => {
  if (ENV_FOLDERS.length === 0) return
  const id = ENV_FOLDERS[0].id
  // 화면이 예전과 똑같이 보이는 게 맞다 — 쓰던 사람이 놀라지 않게
  assert.deepEqual(parseEnvPair(id), { left: id, right: id })
})

/* ---------------- 좌우 함께 바꾸기 ---------------- */

const CROSS = { left: 'prod', right: 'test' }

test('묶지 않으면 고른 쪽만 바뀐다', () => {
  assert.deepEqual(pickEnv(CROSS, 'left', 'test', false), { left: 'test', right: 'test' })
  assert.deepEqual(pickEnv(CROSS, 'right', 'prod', false), { left: 'prod', right: 'prod' })
  assert.deepEqual(pickEnv(CROSS, 'left', 'dev', false), { left: 'dev', right: 'test' })
})

test('묶으면 어느 쪽에서 골라도 양쪽이 함께 간다', () => {
  const same = { left: 'prod', right: 'prod' }
  assert.deepEqual(pickEnv(same, 'left', 'test', true), { left: 'test', right: 'test' })
  assert.deepEqual(pickEnv(same, 'right', 'test', true), { left: 'test', right: 'test' })
})

test('바꾸기 전 좌우가 달라도 묶여 있으면 양쪽이 고른 값으로 모인다', () => {
  assert.deepEqual(pickEnv(CROSS, 'right', 'test', true), { left: 'test', right: 'test' })
})

test('원래 선택을 고치지 않는다 — 새 쌍을 돌려준다', () => {
  const before = { ...CROSS }
  pickEnv(CROSS, 'left', 'test', true)
  pickEnv(CROSS, 'left', 'test', false)
  assert.deepEqual(CROSS, before)
})

test('묶기를 켜면 오른쪽이 왼쪽 환경에 맞춰진다', () => {
  assert.deepEqual(linkEnvPair(CROSS), { left: 'prod', right: 'prod' })
  assert.deepEqual(linkEnvPair({ left: 'test', right: 'test' }), { left: 'test', right: 'test' })
})

test('묶기는 처음 켜져 있고, 끈 저장값만 끈다', () => {
  assert.equal(parseEnvLinked(null), true, '저장된 게 없으면 켜진 채 연다')
  assert.equal(parseEnvLinked('1'), true)
  assert.equal(parseEnvLinked('0'), false, '끈 적이 있으면 끈 채 연다')
  assert.equal(parseEnvLinked(''), true)
  assert.equal(parseEnvLinked('true'), true, '모르는 값은 처음과 같이 본다')
})

test('고른 환경은 실제로 붙일 경로를 돌려준다', () => {
  const first = ENV_FOLDERS[0]
  if (!first) return
  assert.equal(envPath(first.id), first.path)
  assert.equal(joinRoot('/srv/release', envPath(first.id)), `/srv/release/${first.path}`)
})

/* ---------------- 환경별 색 ---------------- */

test('환경마다 다른 색이 붙는다 — 운영과 테스트를 색으로도 가른다', () => {
  const classes = ENV_FOLDERS.map((e) => envColorClass(e.id))
  assert.equal(new Set(classes).size, classes.length, `색이 겹치면 안 된다: ${classes}`)
  for (const cls of classes) assert.match(cls, /^env-c\d$/)
})

test('색은 목록 순서로 정해진다 — 환경 이름은 프로젝트마다 다르다', () => {
  assert.equal(envColorClass(ENV_FOLDERS[0].id), 'env-c0')
  if (ENV_FOLDERS.length > 1) assert.equal(envColorClass(ENV_FOLDERS[1].id), 'env-c1')
})

test('없는 id 는 색을 주지 않는다 — 그때는 좌/우 색을 그대로 쓴다', () => {
  assert.equal(envColorClass('없는환경'), '')
  assert.equal(envColorClass(''), '')
})
