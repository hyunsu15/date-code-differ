import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * shl/deploy.sh · deploy-rollback.sh 를 진짜로 돌린다. 바꾸는 것은 **외부 경계 둘뿐**이다.
 *
 * - 빌드 — BUILD_CMD 를 가짜 빌드 스크립트로 두고, dist_next · backend_next 를 만들게 한다.
 * - ssh — 마지막 인자(원격 명령)를 가짜 홈에서 bash 로 실행한다. 표준입력(tar)도 그대로 받는다.
 *   그래서 임시 폴더 풀기 · 바꿔 끼우기 · 서버 명령(진짜 update.sh)이 실제 셸에서 돈다.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.resolve(here, '..')

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const bash = process.platform === 'win32' ? GIT_BASH : 'bash'
const hasBash = process.platform !== 'win32' || existsSync(GIT_BASH)
const isWindows = process.platform === 'win32'

/** bash 에 넘길 경로 — 윈도우 역슬래시는 큰따옴표 안에서도 탈출 문자로 읽힐 수 있다 */
const posix = (p: string): string => p.replace(/\\/g, '/')

const BUILD_STUB = `#!/usr/bin/env bash
pwd > "$STUB_DIR/build.cwd"
if [ -f "$STUB_DIR/build.fail" ]; then echo "빌드 깨짐" >&2; exit 2; fi
rm -rf dist_next backend_next
mkdir -p dist_next/assets backend_next
echo "<html>new</html>" > dist_next/index.html
echo "app.js" > dist_next/assets/app.js
echo "// new" > backend_next/main.mjs
`

// 호출마다 인자를 한 줄로 남긴다 — 몇 번 불렸는지와 원격 명령을 본다
const SSH_STUB = `#!/usr/bin/env bash
printf '%s\\n' "\${@: -1}" >> "$STUB_DIR/ssh.calls"
if [ -f "$STUB_DIR/ssh.fail" ]; then exit 255; fi
if [ -f "$STUB_DIR/ssh.truncate" ]; then
  head -c 64 | (cd "$HOME" && bash -c "\${@: -1}")
  exit
fi
cd "$HOME" && exec bash -c "\${@: -1}"
`

interface Fixture {
  root: string
  stub: string
  home: string
}

interface EnvOptions {
  deployFiles?: string
  remoteDir?: string
  remoteCmd?: string
  rollbackCmd?: string
  buildDir?: string
}

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'deploy-'))
  const stub = path.join(root, 'stub')
  const home = path.join(root, 'home')
  // 설정은 스크립트 옆이 아니라 저장소의 change/ 에서 읽는다 — 같은 배치로 만든다
  for (const dir of [path.join(root, 'shl'), path.join(root, 'change'), stub, home]) mkdirSync(dir)

  for (const name of ['deploy.sh', 'deploy-rollback.sh']) copyFileSync(path.join(repoDir, 'shl', name), path.join(root, 'shl', name))
  copyFileSync(path.join(repoDir, 'shl', 'deploy.env.example'), path.join(root, 'shl', 'deploy.env.example'))
  // 서버 명령은 진짜 update.sh · rollback.sh 로 돌려 본다
  for (const name of ['update.sh', 'rollback.sh']) copyFileSync(path.join(repoDir, name), path.join(root, name))
  writeFileSync(path.join(stub, 'build.sh'), BUILD_STUB, { mode: 0o755 })
  writeFileSync(path.join(stub, 'ssh'), SSH_STUB, { mode: 0o755 })
  return { root, stub, home }
}

function writeEnv(fx: Fixture, options: EnvOptions = {}): void {
  const lines = [
    'SSH_HOST="fake-server"',
    'SSH_USER="deploy"',
    `BUILD_CMD="bash '${posix(path.join(fx.stub, 'build.sh'))}'"`,
    `BUILD_DIR="${options.buildDir ?? ''}"`,
    `DEPLOY_FILES="${options.deployFiles ?? 'dist_next backend_next update.sh rollback.sh'}"`,
    `REMOTE_DIR="${options.remoteDir ?? '~/code-diff'}"`,
    `REMOTE_CMD="${options.remoteCmd ?? 'bash update.sh'}"`,
    `ROLLBACK_CMD="${options.rollbackCmd ?? 'bash rollback.sh'}"`,
  ]
  writeFileSync(path.join(fx.root, 'change', 'deploy.env'), lines.join('\n') + '\n')
}

/**
 * 가짜 ssh 를 PATH 맨 앞에 둔 채 스크립트를 돌린다.
 * Git Bash 는 시작하면서 /usr/bin 을 PATH 앞에 붙이므로 bash 안에서 다시 앞에 붙인다.
 */
const PREPEND_STUB =
  'export PATH="$(cygpath -u "$STUB_DIR" 2>/dev/null || printf %s "$STUB_DIR"):$PATH"; exec bash "$0" "$@"'

function run(fx: Fixture, args: string[] = [], script = 'deploy.sh') {
  return spawnSync(bash, ['-c', PREPEND_STUB, posix(path.join(fx.root, 'shl', script)), ...args], {
    input: '',
    encoding: 'utf8',
    env: { ...process.env, HOME: fx.home, STUB_DIR: posix(fx.stub) },
  })
}

const sshCalls = (fx: Fixture): string[] => {
  const file = path.join(fx.stub, 'ssh.calls')
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : []
}

const remote = (fx: Fixture, ...parts: string[]): string => path.join(fx.home, 'code-diff', ...parts)

test('빌드 → 옮기기 → 서버 명령(update.sh)까지 돌아 운영 폴더가 새 빌드로 바뀐다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)

  const result = run(fx)
  assert.equal(result.status, 0, result.stderr)

  assert.equal(readFileSync(remote(fx, 'dist', 'index.html'), 'utf8'), '<html>new</html>\n')
  assert.equal(readFileSync(remote(fx, 'backend', 'main.mjs'), 'utf8'), '// new\n')
  assert.ok(existsSync(remote(fx, 'rollback.sh')))
  assert.ok(!existsSync(remote(fx, '.deploy.tmp')), '임시 폴더가 남으면 안 된다')
  assert.equal(sshCalls(fx).length, 2)
})

test('서버에 있던 같은 이름은 통째로 바뀐다 — 예전 파일이 섞이지 않는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx, { remoteCmd: '' })
  mkdirSync(remote(fx, 'dist_next'), { recursive: true })
  writeFileSync(remote(fx, 'dist_next', 'old.js'), 'old')
  writeFileSync(remote(fx, 'keep.txt'), 'keep')

  const result = run(fx)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!existsSync(remote(fx, 'dist_next', 'old.js')))
  assert.ok(existsSync(remote(fx, 'dist_next', 'assets', 'app.js')))
  assert.equal(readFileSync(remote(fx, 'keep.txt'), 'utf8'), 'keep', 'DEPLOY_FILES 밖은 건드리지 않는다')
})

test('빌드가 실패하면 서버에 붙지 않는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  writeFileSync(path.join(fx.stub, 'build.fail'), '')

  const result = run(fx)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /빌드에 실패/)
  assert.deepEqual(sshCalls(fx), [])
})

test('--skip-build 는 빌드하지 않고 있는 것을 옮기고, --no-run 은 서버 명령을 건너뛴다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  mkdirSync(path.join(fx.root, 'dist_next'))
  mkdirSync(path.join(fx.root, 'backend_next'))
  writeFileSync(path.join(fx.root, 'dist_next', 'index.html'), 'prebuilt')

  const result = run(fx, ['--skip-build', '--no-run'])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!existsSync(path.join(fx.stub, 'build.cwd')), '빌드가 돌면 안 된다')
  assert.equal(readFileSync(remote(fx, 'dist_next', 'index.html'), 'utf8'), 'prebuilt')
  assert.ok(!existsSync(remote(fx, 'dist')), 'update.sh 가 돌면 안 된다')
  assert.equal(sshCalls(fx).length, 1)
})

test('빌드는 BUILD_DIR 에서 돌고, 옮길 것도 거기서 찾는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  mkdirSync(path.join(fx.root, 'app'))
  writeEnv(fx, { buildDir: 'app', deployFiles: 'dist_next', remoteCmd: '' })

  const result = run(fx)
  assert.equal(result.status, 0, result.stderr)
  assert.match(readFileSync(path.join(fx.stub, 'build.cwd'), 'utf8').trim(), /\/app$/)
  assert.ok(existsSync(remote(fx, 'dist_next', 'index.html')))
})

test('옮길 것이 빌드 뒤에도 없으면 서버에 붙지 않는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx, { deployFiles: 'dist_next missing_dir' })

  const result = run(fx)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /missing_dir/)
  assert.deepEqual(sshCalls(fx), [])
})

test('DEPLOY_FILES 에 / · .. 가 들어가면 서버 폴더 밖을 지울 수 있어 막는다', { skip: !hasBash }, () => {
  for (const bad of ['../etc', '/', '..', 'dist_next/assets']) {
    const fx = makeFixture()
    writeEnv(fx, { deployFiles: `dist_next ${bad}` })

    const result = run(fx)
    assert.notEqual(result.status, 0, bad)
    assert.match(result.stderr, /DEPLOY_FILES/, bad)
    assert.ok(!existsSync(path.join(fx.stub, 'build.cwd')), `${bad}: 빌드 전에 멈춰야 한다`)
  }
})

test('전송이 끊기면 서버의 기존 파일을 그대로 두고 서버 명령도 돌리지 않는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  mkdirSync(remote(fx), { recursive: true })
  writeFileSync(remote(fx, 'update.sh'), 'old update')
  writeFileSync(path.join(fx.stub, 'ssh.truncate'), '')

  const result = run(fx)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /옮기기에 실패/)
  assert.equal(readFileSync(remote(fx, 'update.sh'), 'utf8'), 'old update')
  assert.ok(!existsSync(remote(fx, '.deploy.tmp')))
  assert.equal(sshCalls(fx).length, 1)
})

test('ssh 에 못 붙으면 서버 명령을 돌리지 않는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  writeFileSync(path.join(fx.stub, 'ssh.fail'), '')

  const result = run(fx)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /종료 코드 255/)
  assert.equal(sshCalls(fx).length, 1)
})

test('서버 명령이 실패하면 실패로 끝나고 되돌리는 명령을 알려 준다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx, { remoteCmd: 'bash update.sh && exit 7' })

  const result = run(fx)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /종료 코드 7/)
  assert.match(result.stderr, /rollback\.sh/)
})

test('공백 · 작은따옴표가 든 서버 폴더에도 옮기고 그 안에서 명령을 돌린다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx, { remoteDir: "~/my app/it's", remoteCmd: 'pwd > where.txt' })

  const result = run(fx)
  assert.equal(result.status, 0, result.stderr)
  const dir = path.join(fx.home, 'my app', "it's")
  assert.ok(existsSync(path.join(dir, 'dist_next', 'index.html')))
  assert.match(readFileSync(path.join(dir, 'where.txt'), 'utf8').trim(), /\/my app\/it's$/)
})

test('설정 파일이 없으면 change/ 에 예시로 만들어 주고 멈춘다', { skip: !hasBash }, () => {
  const fx = makeFixture()

  const result = run(fx)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /예시로 만들었습니다/)
  assert.equal(
    readFileSync(path.join(fx.root, 'change', 'deploy.env'), 'utf8'),
    readFileSync(path.join(fx.root, 'shl', 'deploy.env.example'), 'utf8')
  )
  assert.deepEqual(sshCalls(fx), [])
})

test('모르는 인자면 아무것도 하지 않고 멈춘다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)

  const result = run(fx, ['--force'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /--force/)
  assert.ok(!existsSync(path.join(fx.stub, 'build.cwd')))
})

/** 윈도우 래퍼(deploy.cmd · deploy-rollback.cmd)를 cmd 로 부른다. .cmd 는 Node 가 직접 spawn 하지 못하므로 cmd /c 에 한 줄로 넘긴다. */
function runCmd(fx: Fixture, args: string[], wrapperName = 'deploy.cmd') {
  for (const name of [wrapperName, '_git-bash.cmd']) {
    copyFileSync(path.join(repoDir, 'shl', name), path.join(fx.root, 'shl', name))
  }
  const wrapper = path.join(fx.root, 'shl', wrapperName)
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${wrapper}" ${args.join(' ')}`], {
    encoding: 'utf8',
    input: '',
    windowsVerbatimArguments: true,
  })
}

test('윈도우 래퍼는 인자 · 종료 코드를 넘기고, 자기 위치에서 change/ 를 찾는다', { skip: !isWindows || !hasBash }, () => {
  const fx = makeFixture()

  const help = runCmd(fx, ['--help'])
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /deploy\.cmd/)

  const noEnv = runCmd(fx, [])
  assert.equal(noEnv.status, 1)
  assert.ok(existsSync(path.join(fx.root, 'change', 'deploy.env')), noEnv.stderr)
})

// ── deploy-rollback.sh ────────────────────────────────────────────────────

test('롤백은 배포와 같은 서버 · 폴더에서 ROLLBACK_CMD 를 돌려 이전 버전으로 되돌린다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx)
  mkdirSync(remote(fx, 'dist'), { recursive: true })
  writeFileSync(remote(fx, 'dist', 'index.html'), '<html>old</html>\n')

  assert.equal(run(fx).status, 0)
  assert.equal(readFileSync(remote(fx, 'dist', 'index.html'), 'utf8'), '<html>new</html>\n')

  const result = run(fx, [], 'deploy-rollback.sh')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(remote(fx, 'dist', 'index.html'), 'utf8'), '<html>old</html>\n')
  // 배포 2번(옮기기 · 명령) + 롤백 1번 — 롤백은 옮기지 않고 명령만 보낸다
  assert.equal(sshCalls(fx).length, 3)
  assert.match(sshCalls(fx)[2], /&& bash rollback\.sh$/)
})

test('롤백 명령을 바꾸면 그 명령을 그대로 돌리고, 실패하면 실패로 끝난다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx, { remoteDir: "~/my app/it's", rollbackCmd: 'pwd > where.txt && exit 4' })
  // 롤백은 폴더를 만들지 않는다 — 배포된 적 없는 폴더면 cd 에서 실패하는 게 맞다
  mkdirSync(path.join(fx.home, 'my app', "it's"), { recursive: true })

  const result = run(fx, [], 'deploy-rollback.sh')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /종료 코드 4/)
  assert.match(readFileSync(path.join(fx.home, 'my app', "it's", 'where.txt'), 'utf8').trim(), /\/my app\/it's$/)
})

test('ROLLBACK_CMD 가 비었으면 서버에 붙지 않는다', { skip: !hasBash }, () => {
  const fx = makeFixture()
  writeEnv(fx, { rollbackCmd: '' })

  const result = run(fx, [], 'deploy-rollback.sh')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ROLLBACK_CMD/)
  assert.deepEqual(sshCalls(fx), [])
})

test('롤백도 설정 파일이 없으면 change/ 에 예시로 만들어 주고 멈춘다', { skip: !hasBash }, () => {
  const fx = makeFixture()

  const result = run(fx, [], 'deploy-rollback.sh')
  assert.equal(result.status, 1)
  assert.ok(existsSync(path.join(fx.root, 'change', 'deploy.env')))
  assert.deepEqual(sshCalls(fx), [])
})

test('윈도우 롤백 래퍼는 종료 코드를 넘기고, 자기 위치에서 change/ 를 찾는다', { skip: !isWindows || !hasBash }, () => {
  const fx = makeFixture()

  const help = runCmd(fx, ['--help'], 'deploy-rollback.cmd')
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /deploy-rollback\.cmd/)

  const noEnv = runCmd(fx, [], 'deploy-rollback.cmd')
  assert.equal(noEnv.status, 1)
  assert.ok(existsSync(path.join(fx.root, 'change', 'deploy.env')), noEnv.stderr)
})
