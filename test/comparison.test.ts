import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareSnapshots, readFilePair } from '../server/comparisonService.ts'
import {
  listSnapshots,
  readFileTexts,
  readRepositoryConfig,
  scanSnapshot,
} from '../server/snapshotRepository.ts'
import { createSource, sourceKey } from '../server/source/resolve.ts'
import type { RawFile, SnapshotSource } from '../server/source/types.ts'
import { createHash } from 'node:crypto'
import { DEFAULT_OPTIONS } from '../src/lib/normalize.ts'
import type { ComparedFile, PackageChange, SourceConfig } from '../src/types.ts'

/**
 * 외부 폴더 읽기는 fs 라는 외부 경계라 mock 하지 않고
 * 저장소에 함께 들어있는 `sample-code` 를 실제 fixture 로 쓴다.
 *
 * 예시 폴더는 환경(`prod` · `test`)으로 나뉘어 있다 — 화면에서 운영을 고른 것과 같은 위치다.
 * 환경을 고르는 일 자체는 화면이 하고(`withEnv`), 여기서는 그 결과 경로만 받는다.
 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cfg = readRepositoryConfig()
const LOCAL: SourceConfig = { mode: 'local', root: './sample-code/prod', encoding: 'auto' }
const source = createSource(LOCAL, projectRoot)
const key = sourceKey(LOCAL, projectRoot)

const find = (files: readonly ComparedFile[], p: string): ComparedFile => {
  const f = files.find((x) => x.path === p)
  assert.ok(f, `fixture 에 ${p} 가 있어야 함`)
  return f
}

const pkg = (packages: readonly PackageChange[], name: string): PackageChange => {
  const p = packages.find((x) => x.name === name)
  assert.ok(p, `패키지 ${name} 이 있어야 함`)
  return p
}

/* ---------------- 스냅샷 목록 ---------------- */

test('스냅샷 목록은 최신 날짜가 위로 온다', async () => {
  const items = await listSnapshots(source, cfg, key)
  assert.deepEqual(
    items.map((s) => s.id),
    ['2026-09-01', '2026-08-01', '2026-07-01', '2026-06-01']
  )
})

test('스냅샷마다 파일 수·패키지 수를 센다', async () => {
  const items = await listSnapshots(source, cfg, key)
  const latest = items[0]
  assert.equal(latest.id, '2026-09-01')
  assert.equal(latest.fileCount, 14)
  assert.equal(latest.packageCount, 4) // ord, pay, rpt, stl (cmm 은 이 시점에 없어졌다)
  assert.equal(latest.sortKey, '20260901')
})

test('잘못된 스냅샷 id 는 빈 결과 — 폴더 밖으로 나가지 않는다', async () => {
  for (const bad of ['..', '../..', 'ord/../..', '', '.']) {
    const scan = await scanSnapshot(source, cfg, key, bad)
    assert.equal(scan.files.length, 0, `막혔어야 함: ${JSON.stringify(bad)}`)
  }
})

/* ---------------- 파일 상태 판정 ---------------- */

test('좌우 비교 — 신규/삭제/변경/동일을 구분한다', async () => {
  const res = await compareSnapshots(source, cfg, key, '2026-07-01', '2026-08-01', DEFAULT_OPTIONS)

  assert.equal(find(res.files, 'stl/stl_daily.pc').status, 'added')
  assert.equal(find(res.files, 'pay/pay_cancel.pc').status, 'removed')
  assert.equal(find(res.files, 'cmm/cmm_log.pc').status, 'modified')
  assert.equal(find(res.files, 'cmm/cmm_util.pc').status, 'same')
})

test('한쪽에만 있는 파일도 통계를 채운다 — 전체 합계가 실제 변경량을 반영해야 한다', async () => {
  const res = await compareSnapshots(source, cfg, key, '2026-07-01', '2026-08-01', DEFAULT_OPTIONS)

  const added = find(res.files, 'stl/stl_daily.pc')
  assert.ok(added.stats.added > 0, '신규 파일은 전 줄이 added 여야 한다')
  assert.equal(added.stats.removed, 0)
  assert.equal(added.stats.lineSimilarity, 0)

  const removed = find(res.files, 'pay/pay_cancel.pc')
  assert.ok(removed.stats.removed > 0, '삭제 파일은 전 줄이 removed 여야 한다')
  assert.equal(removed.stats.added, 0)
})

test('동일한 파일은 변경 줄 0, 유사도 1', async () => {
  const res = await compareSnapshots(source, cfg, key, '2026-07-01', '2026-08-01', DEFAULT_OPTIONS)
  const same = find(res.files, 'cmm/cmm_util.pc')
  assert.equal(same.stats.changedLines, 0)
  assert.equal(same.stats.lineSimilarity, 1)
})

test('같은 스냅샷끼리 비교하면 전부 동일', async () => {
  const res = await compareSnapshots(source, cfg, key, '2026-08-01', '2026-08-01', DEFAULT_OPTIONS)
  assert.ok(res.files.length > 0)
  assert.ok(
    res.files.every((f) => f.status === 'same'),
    '모든 파일이 same 이어야 한다'
  )
  assert.ok(res.packages.every((p) => p.status === 'same'))
})

test('좌우를 뒤집으면 신규와 삭제가 뒤바뀐다', async () => {
  const forward = await compareSnapshots(source, cfg, key, '2026-07-01', '2026-08-01', DEFAULT_OPTIONS)
  const backward = await compareSnapshots(source, cfg, key, '2026-08-01', '2026-07-01', DEFAULT_OPTIONS)

  assert.equal(find(forward.files, 'stl/stl_daily.pc').status, 'added')
  assert.equal(find(backward.files, 'stl/stl_daily.pc').status, 'removed')
  assert.equal(find(forward.files, 'pay/pay_cancel.pc').status, 'removed')
  assert.equal(find(backward.files, 'pay/pay_cancel.pc').status, 'added')
})

/* ---------------- 패키지 요약 ---------------- */

test('한쪽에만 있는 패키지는 신규/삭제로 표시한다', async () => {
  const res = await compareSnapshots(source, cfg, key, '2026-07-01', '2026-08-01', DEFAULT_OPTIONS)
  const stl = pkg(res.packages, 'stl')
  assert.equal(stl.status, 'added')
  assert.equal(stl.added, 3)
  assert.ok(stl.changedLines > 0, '신규 패키지의 변경 줄 수가 0 이면 안 된다')
})

test('파일이 하나라도 움직인 패키지는 변경으로 표시한다', async () => {
  const res = await compareSnapshots(source, cfg, key, '2026-07-01', '2026-08-01', DEFAULT_OPTIONS)

  const pay = pkg(res.packages, 'pay')
  assert.equal(pay.status, 'modified') // 파일 수정은 없고 신규 3 + 삭제 1 뿐이어도 변경이다
  assert.equal(pay.modified, 0)
  assert.equal(pay.added, 3) // pay_pg.pks · pay_pg.pkb · rpt_notice.pc(EUC-KR)
  assert.equal(pay.removed, 1)

  const ord = pkg(res.packages, 'ord')
  assert.equal(ord.status, 'modified')
  assert.equal(ord.modified, 2)
})

test('08-01 → 09-01 은 패키지 4가지 상태를 모두 보여준다', async () => {
  // 이 조합이 신규·삭제·변경·동일을 한 화면에서 확인하는 예시다
  const res = await compareSnapshots(source, cfg, key, '2026-08-01', '2026-09-01', DEFAULT_OPTIONS)

  const byStatus = Object.fromEntries(res.packages.map((p) => [p.name, p.status]))
  assert.deepEqual(byStatus, {
    cmm: 'removed', // 공통 모듈이 통째로 빠졌다
    ord: 'modified',
    pay: 'modified',
    rpt: 'added', // 리포트 패키지가 새로 생겼다
    stl: 'same', // 손대지 않은 패키지
  })

  const cmm = pkg(res.packages, 'cmm')
  assert.equal(cmm.removed, 3)
  assert.equal(cmm.added, 0)
  assert.ok(cmm.changedLines > 0, '삭제된 패키지의 줄 수가 0 이면 안 된다')

  const rpt = pkg(res.packages, 'rpt')
  assert.equal(rpt.added, 2)
  assert.ok(rpt.changedLines > 0)

  const stl = pkg(res.packages, 'stl')
  assert.equal(stl.changedLines, 0)
  assert.equal(stl.same, 3)
})

test('삭제된 패키지의 파일은 전부 removed 로 잡힌다', async () => {
  const res = await compareSnapshots(source, cfg, key, '2026-08-01', '2026-09-01', DEFAULT_OPTIONS)
  const cmmFiles = res.files.filter((f) => f.packageName === 'cmm')

  assert.equal(cmmFiles.length, 3)
  assert.ok(
    cmmFiles.every((f) => f.status === 'removed'),
    '모두 removed 여야 한다'
  )
  assert.ok(cmmFiles.every((f) => f.rightSize === null && f.leftSize !== null))
})

test('패키지 변경 줄 수 = 소속 파일 변경 줄 수의 합', async () => {
  const res = await compareSnapshots(source, cfg, key, '2026-06-01', '2026-08-01', DEFAULT_OPTIONS)
  for (const p of res.packages) {
    const expected = res.files
      .filter((f) => f.packageName === p.name)
      .reduce((sum, f) => sum + f.stats.changedLines, 0)
    assert.equal(p.changedLines, expected, `패키지 ${p.name}`)
  }
})

/* ---------------- 인코딩 ---------------- */

test('EUC-KR 로 저장된 소스의 한글이 자동 판별로 읽힌다', async () => {
  // sample-code 의 rpt_notice.pc 는 실제 EUC-KR 로 저장돼 있다
  const pair = await readFilePair(source, '2026-08-01', '2026-09-01', 'pay/rpt_notice.pc')

  assert.ok(pair.leftText?.includes('고객 공지 발송 대상 조회'), '이전 쪽 한글 주석')
  assert.ok(pair.rightText?.includes('발송 이력을 남겨 재발송을 막는다'), '이후 쪽 한글 주석')
  assert.ok(!pair.leftText?.includes('�'), '대체문자가 남으면 안 된다')
})

test('EUC-KR 파일도 한글 주석 변경이 diff 에 잡힌다', async () => {
  const res = await compareSnapshots(source, cfg, key, '2026-08-01', '2026-09-01', DEFAULT_OPTIONS)
  const notice = find(res.files, 'pay/rpt_notice.pc')

  assert.equal(notice.status, 'modified')
  assert.ok(notice.stats.added > 0)
})

test('UTF-8 로 고정하면 EUC-KR 파일이 깨진다 (설정이 실제로 먹는다는 증거)', async () => {
  const utf8Config: SourceConfig = { ...LOCAL, encoding: 'utf-8' }
  const utf8Source = createSource(utf8Config, projectRoot)

  const texts = await readFileTexts(utf8Source, '2026-08-01', ['pay/rpt_notice.pc'])
  const text = texts.get('pay/rpt_notice.pc')
  assert.ok(text)
  assert.ok(text.includes('�'), 'UTF-8 로 읽으면 대체문자가 생겨야 한다')
  assert.ok(!text.includes('고객 공지'), '한글이 제대로 읽히면 안 된다')
})

/* ---------------- 체크섬으로 같은 파일 건너뛰기 ---------------- */

/**
 * 체크섬을 낼 수 있는 소스를 흉내 낸다 (SSH 의 `cksum` 자리).
 *
 * fs 를 mock 하지 않는다 — 실제 `sample-code` 를 읽는 `LocalSource` 를 그대로 감싸고,
 * 목록에 체크섬만 얹은 뒤 **본문을 몇 번 읽었는지** 센다. 로컬 소스는 체크섬을 내지
 * 않으므로(내려면 파일을 한 번 더 읽어야 해서 손해다) 이 경로는 감싸지 않으면 안 밟힌다.
 */
class CountingSource implements SnapshotSource {
  readonly reads: string[] = []
  private readonly inner: SnapshotSource
  private readonly withChecksum: boolean

  constructor(inner: SnapshotSource, withChecksum: boolean) {
    this.inner = inner
    this.withChecksum = withChecksum
  }

  describe(): string {
    return this.inner.describe()
  }

  listSnapshotDirs(): Promise<string[]> {
    return this.inner.listSnapshotDirs()
  }

  async listFilesIn(ids: readonly string[]): Promise<Map<string, RawFile[]>> {
    const listed = await this.inner.listFilesIn(ids)
    if (!this.withChecksum) return listed

    const out = new Map<string, RawFile[]>()
    for (const [id, files] of listed) {
      const texts = await this.inner.readFiles(
        id,
        files.map((f) => f.path)
      )
      out.set(
        id,
        files.map((f) => ({
          ...f,
          checksum: createHash('sha1')
            .update(texts.get(f.path) ?? '')
            .digest('hex'),
        }))
      )
    }
    return out
  }

  readFiles(id: string, paths: readonly string[]): Promise<Map<string, string>> {
    for (const p of paths) this.reads.push(`${id}/${p}`)
    return this.inner.readFiles(id, paths)
  }
}

test('내용이 같은 파일은 한쪽만 읽는다 — 결과는 전부 읽었을 때와 같다', async () => {
  const plain = new CountingSource(createSource(LOCAL, projectRoot), false)
  const fast = new CountingSource(createSource(LOCAL, projectRoot), true)

  const full = await compareSnapshots(plain, cfg, 'plain', '2026-06-01', '2026-07-01')
  const skipped = await compareSnapshots(fast, cfg, 'fast', '2026-06-01', '2026-07-01')

  // 성능 개선이 정확성을 바꾸면 그건 버그다. 요약 카드가 쓰는 총 줄 수·문자 수까지 같아야 한다.
  assert.deepEqual(skipped, full, '체크섬으로 건너뛴 결과가 전부 읽은 결과와 달라지면 안 된다')

  const sameFiles = full.files.filter((f) => f.status === 'same')
  assert.ok(sameFiles.length > 0, 'fixture 에 동일 파일이 있어야 의미가 있는 검증이다')
  assert.equal(
    fast.reads.length,
    plain.reads.length - sameFiles.length,
    '동일한 파일 수만큼 읽기가 줄어야 한다'
  )
})

test('체크섬이 없는 소스는 예전처럼 양쪽을 다 읽는다', async () => {
  const plain = new CountingSource(createSource(LOCAL, projectRoot), false)
  await compareSnapshots(plain, cfg, 'plain-only', '2026-06-01', '2026-07-01')

  const both = plain.reads.filter((r) => r.startsWith('2026-06-01/')).length
  assert.ok(both > 0)
})

/* ---------------- 무시 옵션 ---------------- */

test('무시 옵션은 비교 결과에 반영된다 (캐시가 옵션을 구분해야 한다)', async () => {
  const strict = await compareSnapshots(source, cfg, key, '2026-06-01', '2026-07-01', DEFAULT_OPTIONS)
  const loose = await compareSnapshots(source, cfg, key, '2026-06-01', '2026-07-01', {
    ...DEFAULT_OPTIONS,
    ignoreComments: true,
    ignoreBlankLines: true,
  })

  const strictChanged = strict.files.filter((f) => f.status !== 'same').length
  const looseChanged = loose.files.filter((f) => f.status !== 'same').length
  assert.ok(
    looseChanged <= strictChanged,
    '주석·빈 줄을 무시하면 변경 파일이 늘어날 수 없다'
  )
  // 같은 캐시를 나눠 쓰면 두 결과가 동일해져 이 값이 어긋난다
  assert.notEqual(strict.files[0].stats, loose.files[0].stats)
})

/* ---------------- 본문 읽기 ---------------- */

test('선택한 파일의 좌우 본문을 읽는다', async () => {
  const pair = await readFilePair(source, '2026-07-01', '2026-08-01', 'cmm/cmm_log.pc')
  assert.equal(pair.path, 'cmm/cmm_log.pc')
  assert.ok(pair.leftText?.includes('log_write'))
  assert.ok(pair.rightText?.includes('log_set_level'), '이후 스냅샷에만 있는 함수')
  assert.ok(!pair.leftText?.includes('log_set_level'))
})

test('한쪽에만 있는 파일은 그쪽 본문만 온다', async () => {
  const added = await readFilePair(source, '2026-07-01', '2026-08-01', 'stl/stl_daily.pc')
  assert.equal(added.leftText, null)
  assert.ok(added.rightText)

  const removed = await readFilePair(source, '2026-07-01', '2026-08-01', 'pay/pay_cancel.pc')
  assert.ok(removed.leftText)
  assert.equal(removed.rightText, null)
})

test('경로 탈출 시도는 본문을 돌려주지 않는다', async () => {
  const attacks = [
    '../../package.json',
    'ord/../../../package.json',
    '/etc/passwd',
    'C:/Windows/win.ini',
    '..',
  ]
  const texts = await readFileTexts(source, '2026-08-01', attacks)
  for (const attack of attacks) {
    assert.equal(texts.has(attack), false, `막혔어야 함: ${attack}`)
  }
})

test('없는 파일은 결과에서 빠진다 — 빈 파일과 구분된다', async () => {
  const texts = await readFileTexts(source, '2026-08-01', ['nope/none.pc'])
  assert.equal(texts.has('nope/none.pc'), false)
})
