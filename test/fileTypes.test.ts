import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_EXTENSIONS,
  extensionOf,
  hasComparableExt,
  packageOf,
  parseExtensions,
  ROOT_PACKAGE,
  safeRelativePath,
  SKIP_DIR_RE,
  snapshotSortKey,
} from '../src/lib/fileTypes.ts'

/* ---------------- parseExtensions ---------------- */

test('확장자 목록 — 점·공백·대문자를 정규화한다', () => {
  const set = parseExtensions(' .PC , pkb ,PKS ')
  assert.deepEqual([...set].sort(), ['pc', 'pkb', 'pks'])
})

test('확장자 목록 — 비어 있으면 기본값을 쓴다', () => {
  for (const raw of ['', '   ', ',,,', undefined, null]) {
    const set = parseExtensions(raw)
    assert.equal(set.size, DEFAULT_EXTENSIONS.length, `입력: ${JSON.stringify(raw)}`)
    assert.ok(set.has('pc'))
  }
})

/* ---------------- extensionOf / hasComparableExt ---------------- */

test('확장자 추출 — 점 없는 파일과 dotfile 은 확장자가 없다', () => {
  assert.equal(extensionOf('ord/ord_create.pc'), 'pc')
  assert.equal(extensionOf('Makefile'), '')
  assert.equal(extensionOf('.gitignore'), '') // 앞의 점은 확장자 구분이 아니다
  assert.equal(extensionOf('a.b/c'), '') // 경로에만 점이 있는 경우
  assert.equal(extensionOf('backup.PC'), 'pc')
})

test('비교 대상 판별 — 허용 목록에 있는 확장자만 통과', () => {
  const allowed = parseExtensions('pc,h')
  assert.equal(hasComparableExt('ord/a.pc', allowed), true)
  assert.equal(hasComparableExt('ord/a.h', allowed), true)
  assert.equal(hasComparableExt('ord/a.o', allowed), false)
  assert.equal(hasComparableExt('Makefile', allowed), false)
})

/* ---------------- snapshotSortKey ---------------- */

test('구분자가 있든 없든 같은 정렬키가 나온다', () => {
  for (const name of ['20260801', '2026-08-01', '2026.08.01', '2026_08_01', '2026/08/01']) {
    assert.equal(snapshotSortKey(name), '20260801', name)
  }
})

test('접두·접미가 붙어도 날짜를 찾아낸다', () => {
  for (const name of [
    'rel_20260801',
    '20260801_v2',
    '20260801-hotfix',
    'v2_20260801', // 앞에 숫자가 붙어 자릿수가 밀리는 경우
    'REL1_20260801',
    'build-3-2026-08-01',
    '120260801', // 8자리 앞에 숫자 하나가 더 붙은 경우
  ]) {
    assert.equal(snapshotSortKey(name), '20260801', name)
  }
})

test('이름에 날짜가 여러 개면 앞에 있는 것을 쓴다', () => {
  assert.equal(snapshotSortKey('20260801_to_20260901'), '20260801')
})

test('날짜로 볼 수 없으면 빈 문자열 — 호출부가 이름순으로 떨어뜨린다', () => {
  const notDates = [
    'trunk',
    'main',
    '2026-08', // 자릿수 부족
    '2026080', // 7자리
    '2026-13-01', // 13월
    '2026-08-32', // 32일
    '2026-00-01', // 0월
    '2026-08-00', // 0일
    '99999999',
    '',
  ]
  for (const name of notDates) {
    assert.equal(snapshotSortKey(name), '', JSON.stringify(name))
  }
})

test('연속 호출이 서로 영향을 주지 않는다 (정규식 lastIndex 잔류 없음)', () => {
  // 전역 정규식을 모듈에 두고 재사용하면 두 번째 호출부터 결과가 달라진다
  for (let i = 0; i < 3; i++) {
    assert.equal(snapshotSortKey('v2_20260801'), '20260801')
    assert.equal(snapshotSortKey('20260801'), '20260801')
    assert.equal(snapshotSortKey('trunk'), '')
  }
})

/* ---------------- safeRelativePath (보안 경계) ---------------- */

test('안전한 상대 경로만 통과시킨다', () => {
  assert.equal(safeRelativePath('ord/ord_create.pc'), 'ord/ord_create.pc')
  assert.equal(safeRelativePath('./ord/a.pc'), 'ord/a.pc')
  assert.equal(safeRelativePath('ord\\a.pc'), 'ord/a.pc') // 윈도우 구분자 정규화
})

test('상위 이동·절대 경로는 모두 막는다', () => {
  const blocked = [
    '../secret.pc',
    'ord/../../secret.pc',
    '..',
    '/etc/passwd',
    'C:/Windows/win.ini',
    'c:\\Windows\\win.ini',
    'ord//a.pc', // 빈 세그먼트
    './',
    '',
    '   ',
  ]
  for (const raw of blocked) {
    assert.equal(safeRelativePath(raw), null, `막혔어야 함: ${JSON.stringify(raw)}`)
  }
})

/* ---------------- packageOf ---------------- */

test('패키지 = 날짜 폴더 바로 아래 디렉터리', () => {
  assert.equal(packageOf('ord/ord_create.pc'), 'ord')
  assert.equal(packageOf('ord/sub/deep.pc'), 'ord') // 더 깊어도 최상위 하나로 묶는다
})

test('날짜 폴더에 바로 놓인 파일은 루트 패키지로 묶는다', () => {
  assert.equal(packageOf('README.sql'), ROOT_PACKAGE)
})

/* ---------------- SKIP_DIR_RE ---------------- */

test('빌드 산출물·VCS 폴더는 훑지 않는다', () => {
  for (const p of ['node_modules/x.pc', 'a/.git/b.pc', 'target/a.pc', 'a/bin/b.pc', 'obj']) {
    assert.equal(SKIP_DIR_RE.test(p), true, `건너뛰어야 함: ${p}`)
  }
})

test('이름이 비슷할 뿐인 폴더는 건너뛰지 않는다', () => {
  for (const p of ['binder/a.pc', 'ord/target_calc.pc', 'mybin/a.pc']) {
    assert.equal(SKIP_DIR_RE.test(p), false, `살아남아야 함: ${p}`)
  }
})
