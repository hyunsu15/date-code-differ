import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sshOptions } from '../server/source/sshCommands.ts'
import type { SshSourceConfig } from '../src/types.ts'

/**
 * 비밀번호 인증에서는 ssh 의 **모든** 질문이 askpass 로 온다 (`SSH_ASKPASS_REQUIRE=force`).
 * askpass 는 문구를 보지 않고 비밀번호를 답하므로,
 * "비밀번호가 아닌 질문" 은 ssh 옵션 단계에서 없애야 한다.
 *
 * 실제 계약(표준출력·종료코드)을 봐야 의미가 있어 자식 프로세스로 실행한다.
 */

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts')
const PASSWORD = 'secret123'

const CONN: SshSourceConfig = {
  mode: 'ssh',
  auth: 'password',
  host: 'build-01',
  port: null,
  user: 'deploy',
  identityFile: '',
  root: '/srv/rel',
  encoding: 'auto',
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(command, args, { env: { ...process.env, ...env } }, (error, stdout) => {
      resolve({ stdout, code: error ? ((error as { code?: number }).code ?? 1) : 0 })
    })
  })
}

const askpass = (password?: string) =>
  run('node', [path.join(scripts, 'askpass.mjs')], { CODE_DIFF_SSH_PASSWORD: password })

/* ---------------- askpass ---------------- */

test('보관 중인 비밀번호를 표준출력으로 답한다', async () => {
  const { stdout, code } = await askpass(PASSWORD)
  assert.equal(stdout, PASSWORD)
  assert.equal(code, 0)
})

test('비밀번호가 없으면 빈 답 대신 실패한다', async () => {
  // 빈 문자열을 내보내면 ssh 가 "빈 비밀번호" 로 인증을 시도한다
  const { stdout, code } = await askpass(undefined)
  assert.equal(stdout, '')
  assert.notEqual(code, 0)
})

test('묻는 문구를 인자로 받지 않는다 — cmd.exe 재해석 통로를 만들지 않는다', async () => {
  // 원격 서버가 보낸 글자가 섞일 수 있는 값이라, 넘겨받는 것 자체를 하지 않는다
  const wrapper = process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh'
  const source = await fs.readFile(path.join(scripts, wrapper), 'utf8')

  assert.equal(source.includes('%*'), false, 'Windows 래퍼가 인자를 넘기면 안 된다')
  assert.equal(source.includes('"$@"'), false, 'POSIX 래퍼가 인자를 넘기면 안 된다')
})

test('래퍼 스크립트로 실행해도 비밀번호가 나온다', async () => {
  const { stdout } =
    process.platform === 'win32'
      ? await run('cmd.exe', ['/c', path.join(scripts, 'askpass.cmd')], {
          CODE_DIFF_SSH_PASSWORD: PASSWORD,
        })
      : await run('sh', [path.join(scripts, 'askpass.sh')], { CODE_DIFF_SSH_PASSWORD: PASSWORD })

  assert.equal(stdout.trim(), PASSWORD)
})

/* ---------------- ssh 가 물어보지 않게 하는 옵션 ---------------- */

test('호스트 키를 묻지 않는다 — 물어보면 그 답이 비밀번호가 된다', () => {
  const flat = sshOptions(CONN).join(' ')
  assert.ok(flat.includes('StrictHostKeyChecking=yes'), flat)
})
