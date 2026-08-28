import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOURCE_PRESETS } from '../change/config.ts'

/**
 * `npm run ssh-login` 이 **어느 서버의** 비밀번호를 받는지 확인한다.
 *
 * 예전에는 `change/config.ts` 만 보고 정했다. 그런데 화면은 프리셋이 아니라
 * "직접 입력" 값을 쓸 수도 있어서, 넣은 비밀번호가 엉뚱한 키로 저장되고
 * 화면에는 "비밀번호가 없습니다" 가 계속 떴다.
 * 이제는 개발 서버가 기다리는 대상을 먼저 물어본다.
 *
 * 스크립트를 실제로 실행하고, 가짜 개발 서버가 받은 요청으로 확인한다.
 */

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'ssh-login.mjs'
)

interface Posted {
  target: string
  password: string
}

/** 개발 서버 흉내 — GET 으로 기다리는 대상을 알려주고, POST 를 받아 둔다 */
function fakeServer(pending: string | null): Promise<{
  port: number
  posted: Posted[]
  close: () => Promise<void>
}> {
  const posted: Posted[] = []

  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ pending, registered: [] }))
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      posted.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Posted)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        port,
        posted,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}

/** 비밀번호를 파이프로 넣어 스크립트를 돌린다 */
function runLogin(port: number, args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      'node',
      [script, '--port', String(port), ...args],
      (error, stdout, stderr) => {
        resolve({
          code: error ? ((error as { code?: number }).code ?? 1) : 0,
          output: `${stdout}${stderr}`,
        })
      }
    )
    child.stdin?.end('hunter2\n')
  })
}

test('화면이 기다리는 접속이 있으면 설정 파일보다 그것을 쓴다', async () => {
  const server = await fakeServer('deploy@build-01:2222')
  try {
    const { code, output } = await runLogin(server.port, [])

    assert.equal(code, 0, output)
    assert.deepEqual(server.posted, [{ target: 'deploy@build-01:2222', password: 'hunter2' }])
    assert.ok(output.includes('화면이 기다리는 접속'), output)
  } finally {
    await server.close()
  }
})

test('--target 은 화면이 기다리는 대상보다 우선한다', async () => {
  const server = await fakeServer('deploy@build-01:2222')
  try {
    await runLogin(server.port, ['--target', 'other@host-9:22'])
    assert.equal(server.posted[0]?.target, 'other@host-9:22')
  } finally {
    await server.close()
  }
})

test('포트를 생략하면 22 로 맞춰 보낸다 — 화면이 찾는 키와 어긋나지 않게', async () => {
  const server = await fakeServer(null)
  try {
    await runLogin(server.port, ['--target', 'deploy@build-01'])
    assert.equal(server.posted[0]?.target, 'deploy@build-01:22')
  } finally {
    await server.close()
  }
})

test('--target 형식이 아니면 비밀번호를 묻지 않고 멈춘다', async () => {
  const server = await fakeServer(null)
  try {
    const { code, output } = await runLogin(server.port, ['--target', 'host-only'])

    assert.notEqual(code, 0)
    assert.deepEqual(server.posted, [])
    assert.ok(output.includes('--target 형식이 아닙니다'), output)
  } finally {
    await server.close()
  }
})

/* ---------------- 키 인증 프리셋 보호 ---------------- */

const sshPreset = SOURCE_PRESETS.find((p) => p.source.mode === 'ssh')
const keyAuth = sshPreset?.source.mode === 'ssh' && sshPreset.source.auth === 'key'

test(
  '키 인증으로 설정된 프리셋에는 비밀번호를 넣지 않고 멈춘다',
  {
    skip: keyAuth
      ? false
      : 'change/config.ts 의 SSH 프리셋이 비밀번호 인증이라 이 경우가 아니다',
  },
  async () => {
    // 넣어봐야 ssh 는 키로만 접속해서 쓰이지 않는다. 조용히 저장하면 계속 헤매게 된다
    const server = await fakeServer(null)
    try {
      const { code, output } = await runLogin(server.port, [])

      assert.notEqual(code, 0)
      assert.deepEqual(server.posted, [], '비밀번호를 보내면 안 된다')
      assert.ok(output.includes('키 인증'), output)
    } finally {
      await server.close()
    }
  }
)
