import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSchema } from '../src/lib/schemaParse.ts'
import { DEFAULT_SCHEMA_CONFIG } from '../src/types.ts'

/**
 * shl/schema-dump.sh 를 진짜로 돌린다. 바꾸는 것은 **외부 경계 둘뿐**이다.
 *
 * - sqlplus — 받은 SQL 의 PROMPT 줄은 그대로 찍고, `SELECT '[종류]` 마다 준비해 둔 행을 낸다.
 *   그래서 헤더는 스크립트가 보낸 그대로이고, 결과 파일을 화면 파서(parseSchema)로 읽혀 본다.
 * - ssh — 마지막 인자(원격 명령)를 가짜 홈에서 bash 로 실행한다. 원격 쪽 quote · 덮어쓰기 거부 ·
 *   임시 파일 교체가 실제 셸에서 도는지 본다.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const shlDir = path.resolve(here, '..', 'shl')
const changeDir = path.resolve(here, '..', 'change')

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const bash = process.platform === 'win32' ? GIT_BASH : 'bash'
const hasBash = process.platform !== 'win32' || existsSync(GIT_BASH)

/** bash 에 넘길 경로 — 윈도우 역슬래시는 큰따옴표 안에서도 탈출 문자로 읽힐 수 있다 */
const posix = (p: string): string => p.replace(/\\/g, '/')

const ROWS = {
  COLUMN: [
    '[COLUMN],TB_ORD,ORD_NO,VARCHAR2,20,,,N',
    '[COLUMN],TB_ORD,ORD_SEQ,NUMBER,22,5,0,N',
    '[COLUMN],TB_PAY,PAY_NO,VARCHAR2,20,,,N',
  ],
  CONSTRAINT: [
    '[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_NO,1',
    '[CONSTRAINT],TB_ORD,PK_ORD,P,ORD_SEQ,2',
    // 체크 제약은 POSITION 이 NULL 이라 끝 칸이 빈다
    '[CONSTRAINT],TB_ORD,SYS_C0011201,C,ORD_NO,',
  ],
  INDEX: ['[INDEX],TB_ORD,PK_ORD,UNIQUE,ORD_NO,1', '[INDEX],TB_ORD,PK_ORD,UNIQUE,ORD_SEQ,2'],
}

const SQLPLUS_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$STUB_DIR/sqlplus.args"
if [ -f "$STUB_DIR/output" ]; then
  cat > "$STUB_DIR/sqlplus.stdin"
  cat "$STUB_DIR/output"
  exit "$(cat "$STUB_DIR/exitcode" 2>/dev/null || echo 0)"
fi
# 진짜 sqlplus 처럼 윈도우 줄끝(CRLF)으로 낸다
tee "$STUB_DIR/sqlplus.stdin" | while IFS= read -r line; do
  case "$line" in
    PROMPT*) rest="\${line#PROMPT}"; printf '%s\\r\\n' "\${rest# }" ;;
    "SELECT '["*) kind="\${line#SELECT \\'[}"; kind="\${kind%%]*}"; sed 's/$/\\r/' "$STUB_DIR/rows.$kind" 2>/dev/null ;;
  esac
done
`

const SSH_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$STUB_DIR/ssh.args"
if [ -f "$STUB_DIR/ssh.fail" ]; then exit 255; fi
cd "$HOME" && exec bash -c "\${@: -1}"
`

interface Fixture {
  root: string
  stub: string
  home: string
  out: string
}

interface EnvOptions {
  owner?: string
  remoteDir?: string
}

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'schema-dump-'))
  const shl = path.join(root, 'shl')
  const stub = path.join(root, 'stub')
  const home = path.join(root, 'home')
  // 설정은 스크립트 옆이 아니라 저장소의 change/ 에서 읽는다 — 같은 배치로 만든다
  for (const dir of [shl, path.join(root, 'change'), stub, home]) mkdirSync(dir)

  copyFileSync(path.join(shlDir, 'schema-dump.sh'), path.join(shl, 'schema-dump.sh'))
  copyFileSync(path.join(shlDir, 'schema-dump.env.example'), path.join(shl, 'schema-dump.env.example'))
  copyFileSync(path.join(changeDir, 'check_table.sql'), path.join(root, 'change', 'check_table.sql'))
  writeFileSync(path.join(stub, 'sqlplus'), SQLPLUS_STUB, { mode: 0o755 })
  writeFileSync(path.join(stub, 'ssh'), SSH_STUB, { mode: 0o755 })
  for (const [kind, rows] of Object.entries(ROWS)) {
    writeFileSync(path.join(stub, `rows.${kind}`), rows.join('\n') + '\n')
  }
  return { root, stub, home, out: path.join(shl, 'out') }
}

function writeEnv(fx: Fixture, options: EnvOptions = {}): void {
  const lines = [
    `SQLPLUS="${posix(path.join(fx.stub, 'sqlplus'))}"`,
    'SSH_HOST="fake-server"',
    'SSH_USER="deploy"',
    'FILE_NAME="snapshot_{env}_{date}.txt"',
    'PROD_DB_CONNECT="db:1521/ORCL"',
    'PROD_DB_USER="APP"',
    `PROD_DB_OWNER="${options.owner ?? ''}"`,
    `PROD_REMOTE_DIR="${options.remoteDir ?? '~/schema/prod'}"`,
  ]
  writeFileSync(path.join(fx.root, 'change', 'schema-dump.env'), lines.join('\n') + '\n')
}

/**
 * 가짜 ssh 를 PATH 맨 앞에 둔 채 스크립트를 돌린다.
 * Git Bash 는 시작하면서 /usr/bin 을 PATH 앞에 붙이므로 바깥에서 넘긴 PATH 로는 진짜 ssh 가 먼저 잡힌다
 * — 그래서 bash 안에서 다시 앞에 붙인다. `C:/…` 는 PATH 의 `:` 와 겹치므로 cygpath 로 바꾼다.
 */
const PREPEND_STUB =
  'export PATH="$(cygpath -u "$STUB_DIR" 2>/dev/null || printf %s "$STUB_DIR"):$PATH"; exec bash "$0" "$@"'

function run(fx: Fixture, args: string[], password = 's3cr!t') {
  return spawnSync(bash, ['-c', PREPEND_STUB, posix(path.join(fx.root, 'shl', 'schema-dump.sh')), ...args], {
    input: `${password}\n`,
    encoding: 'utf8',
    env: { ...process.env, HOME: fx.home, STUB_DIR: posix(fx.stub) },
  })
}

const remoteFile = (fx: Fixture, name = 'snapshot_prod_2026-10-27.txt'): string =>
  path.join(fx.home, 'schema', 'prod', name)

test('덤프를 만들어 서버 폴더에 올리고, 화면 파서가 그 파일을 읽는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)

  const result = run(fx, ['prod', '2026-10-27'])
  assert.equal(result.status, 0, result.stderr)

  const uploaded = readFileSync(remoteFile(fx), 'utf8')
  assert.equal(readFileSync(path.join(fx.out, 'snapshot_prod_2026-10-27.txt'), 'utf8'), uploaded)
  assert.ok(!uploaded.includes('\r'), 'CRLF 가 남으면 안 된다')

  const snapshot = parseSchema(uploaded, DEFAULT_SCHEMA_CONFIG)
  assert.equal(snapshot.malformed, 0, snapshot.malformedSample.join('\n'))
  assert.deepEqual(
    snapshot.tables.map((t) => t.name),
    ['TB_ORD', 'TB_PAY']
  )
  const ord = snapshot.tables[0]
  assert.deepEqual(
    ord.columns.map((c) => c.type),
    ['VARCHAR2(20)', 'NUMBER(5)']
  )
  // 여러 줄로 흩어진 기본키 · 인덱스가 위치 순으로 묶여야 헤더(POSITION · COLUMN_POSITION · UNIQUENESS)를 제대로 읽은 것이다
  assert.deepEqual(ord.constraints.find((c) => c.name === 'PK_ORD')?.columns, ['ORD_NO', 'ORD_SEQ'])
  assert.equal(ord.indexes[0].unique, true)
  assert.deepEqual(ord.indexes[0].columns, ['ORD_NO', 'ORD_SEQ'])
  assert.match(snapshot.description, /prod 스키마 덤프 — 2026-10-27 · APP/)

  // 임시 파일이 남지 않는다
  assert.deepEqual(readdirSync(path.dirname(remoteFile(fx))), ['snapshot_prod_2026-10-27.txt'])
})

test('비밀번호는 sqlplus 명령줄이 아니라 표준입력으로만 넘긴다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)

  run(fx, ['prod', '2026-10-27'], 'pa ss$w0rd')

  const args = readFileSync(path.join(fx.stub, 'sqlplus.args'), 'utf8')
  assert.ok(!args.includes('pa ss$w0rd'))
  assert.equal(args.trim().split('\n').pop(), '/nolog')
  const stdin = readFileSync(path.join(fx.stub, 'sqlplus.stdin'), 'utf8')
  assert.match(stdin, /^CONNECT APP\/"pa ss\$w0rd"@db:1521\/ORCL$/m)
})

test('&owner 는 DB_OWNER, 비었으면 접속 계정을 대문자로 받는다', { skip: !hasBash }, () => {
  const mine = makeFixture()
  writeEnv(mine)
  run(mine, ['prod', '2026-10-27'])
  assert.match(readFileSync(path.join(mine.stub, 'sqlplus.stdin'), 'utf8'), /^DEFINE owner = APP$/m)

  const other = makeFixture()
  writeEnv(other, { owner: 'scott' })
  const result = run(other, ['prod', '2026-10-27'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(readFileSync(path.join(other.stub, 'sqlplus.stdin'), 'utf8'), /^DEFINE owner = SCOTT$/m)
  assert.match(result.stderr, /조회 중: SCOTT @/)
})

test('change/check_table.sql 을 고치면 그 내용 그대로 조회한다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  // 컬럼만 보도록 고친 SQL — 제약 · 인덱스 줄이 결과에 없어야 한다
  writeFileSync(
    path.join(fx.root, 'change', 'check_table.sql'),
    [
      'PROMPT [COLUMN],TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATA_LENGTH,DATA_PRECISION,DATA_SCALE,NULLABLE',
      "SELECT '[COLUMN],' || TABLE_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = '&owner';",
    ].join('\n')
  )

  const result = run(fx, ['prod', '2026-10-27'])
  assert.equal(result.status, 0, result.stderr)
  const stdin = readFileSync(path.join(fx.stub, 'sqlplus.stdin'), 'utf8')
  assert.match(stdin, /WHERE OWNER = '&owner';/)
  const uploaded = readFileSync(remoteFile(fx), 'utf8')
  assert.match(uploaded, /\[COLUMN\],TB_ORD,ORD_NO/)
  assert.ok(!uploaded.includes('[INDEX]'))
})

test('설정 · 오류 처리는 접속보다 앞에, SQL 파일은 접속 뒤에 붙는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  run(fx, ['prod', '2026-10-27'])

  const stdin = readFileSync(path.join(fx.stub, 'sqlplus.stdin'), 'utf8')
  const at = (needle: string): number => stdin.indexOf(needle)
  // WHENEVER 가 CONNECT 뒤에 오면 접속에 실패해도 sqlplus 가 0 으로 끝난다 (실제 sqlplus 로 확인한 동작)
  assert.ok(at('WHENEVER SQLERROR EXIT FAILURE') < at('CONNECT '))
  assert.ok(at('SET HEADING OFF') < at('CONNECT '))
  // 꺼져 있으면 빈 줄에서 SELECT 가 끊겨 실행되지 않는다 (실제 sqlplus 로 확인: ORDER BY 줄이 SP2-0734)
  assert.ok(at('SET SQLBLANKLINES ON') < at('CONNECT '))
  assert.ok(at('CONNECT ') < at('PROMPT [COLUMN]'))
  assert.ok(stdin.trimEnd().endsWith('EXIT'))
})

test('메모장이 붙인 BOM · CRLF 가 있어도 SQL 첫 줄이 깨지지 않는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  const sqlPath = path.join(fx.root, 'change', 'check_table.sql')
  const original = readFileSync(sqlPath, 'utf8')
  writeFileSync(sqlPath, '﻿' + original.replace(/\n/g, '\r\n'))

  const result = run(fx, ['prod', '2026-10-27'])
  assert.equal(result.status, 0, result.stderr)
  const stdin = readFileSync(path.join(fx.stub, 'sqlplus.stdin'), 'utf8')
  assert.ok(!stdin.includes('﻿'))
  assert.ok(!stdin.includes('\r'))
})

test('owner 말고 다른 치환 변수가 있으면 DB 에 묻기 전에 멈춘다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  writeFileSync(
    path.join(fx.root, 'change', 'check_table.sql'),
    "SELECT '[COLUMN],' || TABLE_NAME FROM ALL_TABLES WHERE OWNER = '&schema' AND x = '&&owner';\n"
  )

  const result = run(fx, ['prod', '2026-10-27'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /&schema/)
  assert.ok(!result.stderr.includes('&&owner '), 'owner 는 && 로 써도 허용한다')
  assert.ok(!existsSync(path.join(fx.stub, 'sqlplus.args')))
})

test('SQL 파일이 없으면 DB 에 묻기 전에 멈춘다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  rmSync(path.join(fx.root, 'change', 'check_table.sql'))

  const result = run(fx, ['prod', '2026-10-27'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /check_table\.sql/)
  assert.ok(!existsSync(path.join(fx.stub, 'sqlplus.args')))
})

test('OWNER 에 식별자가 아닌 글자가 있으면 DB 에 묻기 전에 멈춘다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx, { owner: "X' OR '1'='1" })

  const result = run(fx, ['prod', '2026-10-27'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /PROD_DB_OWNER/)
  assert.ok(!existsSync(path.join(fx.stub, 'sqlplus.args')))
})

test('같은 이름 파일이 서버에 있으면 덮어쓰지 않고, --force 면 덮어쓴다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  mkdirSync(path.dirname(remoteFile(fx)), { recursive: true })
  writeFileSync(remoteFile(fx), 'OLD')

  const refused = run(fx, ['prod', '2026-10-27'])
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /--force/)
  assert.equal(readFileSync(remoteFile(fx), 'utf8'), 'OLD')

  const forced = run(fx, ['prod', '2026-10-27', '--force'])
  assert.equal(forced.status, 0, forced.stderr)
  assert.match(readFileSync(remoteFile(fx), 'utf8'), /\[COLUMN\],TB_ORD,ORD_NO/)
  assert.deepEqual(readdirSync(path.dirname(remoteFile(fx))), ['snapshot_prod_2026-10-27.txt'])
})

test('DB 오류(ORA-)면 서버에 아무것도 올리지 않는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  writeFileSync(path.join(fx.stub, 'output'), 'ERROR:\nORA-01017: invalid username/password; logon denied\n')
  writeFileSync(path.join(fx.stub, 'exitcode'), '1')

  const result = run(fx, ['prod', '2026-10-27'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /ORA-01017/)
  assert.ok(!existsSync(path.join(fx.stub, 'ssh.args')))
})

test('sqlplus 가 0 으로 끝나도 SP2- 오류가 찍혔으면 실패로 본다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  writeFileSync(path.join(fx.stub, 'output'), 'SP2-0640: Not connected\n')

  const result = run(fx, ['prod', '2026-10-27'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /SP2-0640/)
  assert.ok(!existsSync(path.join(fx.stub, 'ssh.args')))
})

test('조회된 테이블이 0개면 빈 파일을 올리지 않는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  for (const kind of Object.keys(ROWS)) writeFileSync(path.join(fx.stub, `rows.${kind}`), '')

  const result = run(fx, ['prod', '2026-10-27'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /테이블이 없습니다/)
  assert.ok(!existsSync(path.join(fx.stub, 'ssh.args')))
})

test('공백 · 작은따옴표가 든 원격 폴더도 그대로 만든다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  const remote = path.join(fx.home, "it's my", 'schema dir')
  writeEnv(fx, { remoteDir: posix(remote) })

  const result = run(fx, ['prod', '2026-10-27'])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(path.join(remote, 'snapshot_prod_2026-10-27.txt')))
})

test('업로드가 실패하면 PC 에 만든 파일을 남기고 손으로 올리는 명령을 알려 준다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  writeFileSync(path.join(fx.stub, 'ssh.fail'), '')

  const result = run(fx, ['prod', '2026-10-27'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /scp /)
  assert.ok(existsSync(path.join(fx.out, 'snapshot_prod_2026-10-27.txt')))
})

test('설정 파일이 없으면 change/ 에 예시로 만들어 주고 멈춘다', { skip: !hasBash }, () => {
  const fx = makeFixture()

  const result = run(fx, ['prod', '2026-10-27'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /예시로 만들었습니다/)
  assert.ok(!existsSync(path.join(fx.root, 'shl', 'schema-dump.env')), '스크립트 옆에 만들면 안 된다')
  assert.equal(
    readFileSync(path.join(fx.root, 'change', 'schema-dump.env'), 'utf8'),
    readFileSync(path.join(shlDir, 'schema-dump.env.example'), 'utf8')
  )
})

test('인자가 틀리면 DB 에 묻기 전에 멈춘다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)

  for (const args of [[], ['prod', '2026/10/27'], ['prod-1'], ['prod', '2026-10-27', 'extra'], ['prod', '--forse']]) {
    const result = run(fx, args)
    assert.notEqual(result.status, 0, `${args.join(' ')} 는 실패해야 한다`)
  }
  assert.ok(!existsSync(path.join(fx.stub, 'sqlplus.args')))
})

/**
 * 윈도우 래퍼(schema-dump.cmd)를 cmd 로 부른다.
 * .cmd 는 Node 가 직접 spawn 하지 못하므로 cmd /c 에 한 줄로 넘긴다.
 */
function runCmd(fx: Fixture, args: string[]) {
  const wrapper = path.join(fx.root, 'shl', 'schema-dump.cmd')
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${wrapper}" ${args.join(' ')}`], {
    encoding: 'utf8',
    input: '',
    windowsVerbatimArguments: true,
  })
}

function copyWrappers(fx: Fixture): void {
  for (const name of ['schema-dump.cmd', '_git-bash.cmd']) {
    copyFileSync(path.join(shlDir, name), path.join(fx.root, 'shl', name))
  }
}

const isWindows = process.platform === 'win32'

test('윈도우 래퍼는 인자와 종료 코드를 그대로 넘긴다', { skip: !isWindows || !hasBash }, () => {
  const fx = makeFixture()
  copyWrappers(fx)

  const help = runCmd(fx, ['--help'])
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /schema-dump\.cmd/)

  const wrongDate = runCmd(fx, ['prod', '2026/10/27'])
  assert.equal(wrongDate.status, 1)
  assert.match(wrongDate.stderr, /YYYY-MM-DD/)
})

test('윈도우 래퍼로 불러도 스크립트가 자기 위치에서 change/ 를 찾는다', { skip: !isWindows || !hasBash }, () => {
  const fx = makeFixture()
  copyWrappers(fx)

  // \ 경로를 그대로 넘기면 bash 의 dirname 이 '.' 이 되어 엉뚱한 곳에 설정을 만든다
  const result = runCmd(fx, ['prod', '2026-10-27'])
  assert.notEqual(result.status, 0)
  assert.ok(existsSync(path.join(fx.root, 'change', 'schema-dump.env')), result.stderr)
})

test('설정에 없는 환경이면 어떤 변수가 비었는지 알려 준다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)

  const result = run(fx, ['dev', '2026-10-27'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /DEV_DB_CONNECT/)
})
