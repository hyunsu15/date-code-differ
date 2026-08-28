import readline from 'node:readline'
import { createRequire } from 'node:module'

/**
 * SSH 비밀번호를 **터미널에서** 받아 실행 중인 개발 서버에 넘긴다.
 *
 *     npm run ssh-login
 *
 * 비밀번호는 브라우저를 거치지 않는다. localStorage·URL·파일 어디에도 남지 않고,
 * 개발 서버 프로세스 메모리에만 있다가 서버를 끄면 사라진다.
 *
 * 값은 `change/config.ts` 의 SSH 프리셋에서 읽어 어느 서버인지 정한다.
 */

const require = createRequire(import.meta.url)

/** `--port 5181` 또는 기본값 */
function readPort() {
  const i = process.argv.indexOf('--port')
  const raw = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(raw) && raw > 0 ? raw : 5181
}

/** `--host user@server` 로 직접 지정하거나, 설정에서 SSH 프리셋을 찾는다 */
async function resolveTarget() {
  const i = process.argv.indexOf('--target')
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]

  const { SOURCE_PRESETS } = await import('../change/config.ts')
  const ssh = SOURCE_PRESETS.filter((p) => p.source.mode === 'ssh')

  if (ssh.length === 0) {
    console.error('[code-diff] change/config.ts 에 SSH 프리셋이 없습니다.')
    process.exit(1)
  }
  if (ssh.length > 1) {
    console.error('[code-diff] SSH 프리셋이 여러 개입니다. --target user@host:port 로 지정하세요.')
    for (const p of ssh) {
      const s = p.source
      console.error(`             ${p.label}: ${s.user}@${s.host}:${s.port ?? 22}`)
    }
    process.exit(1)
  }

  const s = ssh[0].source
  return `${s.user}@${s.host}:${s.port ?? 22}`
}

/** 입력이 화면에 찍히지 않게 가린 채로 한 줄 받는다 */
function askHidden(prompt) {
  // 파이프로 넘겨받는 경우(테스트·자동화)에는 터미널 제어문자를 쓰지 않는다
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin })
      rl.question('', (answer) => {
        rl.close()
        resolve(answer)
      })
    })
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })

    // readline 이 매 글자를 그대로 되찍는 것을 막는다 (프롬프트만 남긴다)
    let shown = false
    rl._writeToOutput = (text) => {
      if (!shown) {
        rl.output.write(prompt)
        shown = true
        return
      }
      // 줄바꿈만 통과시켜 커서가 다음 줄로 가게 한다
      if (text.includes('\n')) rl.output.write('\n')
    }

    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

function postPassword(port, target, password) {
  const body = JSON.stringify({ target, password })
  return new Promise((resolve, reject) => {
    const req = require('node:http').request(
      {
        // Vite 는 localhost 에 바인딩한다 — IPv4/IPv6 어느 쪽이든 붙도록 이름으로 연결한다
        // (127.0.0.1 로 고정하면 서버가 ::1 에만 열려 있을 때 연결이 거부된다)
        host: 'localhost',
        port,
        path: '/api/v1/ssh-credentials',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        )
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

const port = readPort()
const target = await resolveTarget()

console.log(`[code-diff] 개발 서버: http://localhost:${port}`)
console.log(`[code-diff] 접속 대상: ${target}`)

const password = await askHidden(`${target} 비밀번호: `)

if (!password) {
  console.error('[code-diff] 비밀번호가 비어 있어 중단합니다.')
  process.exit(1)
}

try {
  const res = await postPassword(port, target, password)
  if (res.status === 200) {
    console.log('[code-diff] 개발 서버에 전달했습니다. 화면에서 다시 시도하세요.')
  } else {
    console.error(`[code-diff] 전달 실패 (HTTP ${res.status}) ${res.body}`)
    process.exit(1)
  }
} catch (e) {
  console.error(
    `[code-diff] 개발 서버에 연결하지 못했습니다 (http://localhost:${port}).\n` +
      `           \`npm run dev\` 가 실행 중인지 확인하세요. 포트가 다르면 --port 로 지정합니다.\n` +
      `           ${e.message}`
  )
  process.exit(1)
}
