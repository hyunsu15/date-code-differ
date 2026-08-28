import readline from 'node:readline'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { normalizeConnectionTarget } from '../server/source/passwordStore.ts'

/**
 * SSH 비밀번호를 **터미널에서** 받아 실행 중인 개발 서버에 넘긴다.
 *
 *     npm run ssh-login
 *
 * 비밀번호는 브라우저를 거치지 않는다. localStorage·URL·파일 어디에도 남지 않고,
 * 개발 서버 프로세스 메모리에만 있다가 서버를 끄면 사라진다.
 *
 * 어느 서버인지는 이 순서로 정한다.
 *   1. `--target user@host[:port]` 로 직접 지정
 *   2. **개발 서버가 기다리는 대상** — 화면이 방금 비밀번호를 요구한 접속
 *   3. `change/config.ts` 의 SSH 프리셋
 *
 * 2번이 있는 이유: 화면은 프리셋이 아니라 "직접 입력" 값을 쓸 수도 있고
 * SSH 프리셋이 여러 개일 수도 있다. 설정 파일만 보면 엉뚱한 서버에 비밀번호를 넣게 되고,
 * 넣었는데도 화면에는 "비밀번호가 없습니다" 가 계속 뜬다.
 */

const require = createRequire(import.meta.url)

/** `--port 5181` 또는 기본값 */
export function readPort(argv = process.argv) {
  const i = argv.indexOf('--port')
  const raw = i >= 0 ? Number(argv[i + 1]) : NaN
  return Number.isFinite(raw) && raw > 0 ? raw : 5181
}

/** `--target user@host[:port]` — 적었으면 보관 키와 같은 형태로 맞춰서 돌려준다 */
export function readTargetOption(argv = process.argv) {
  const i = argv.indexOf('--target')
  if (i < 0 || !argv[i + 1]) return null

  const target = normalizeConnectionTarget(argv[i + 1])
  if (target === null) {
    console.error(`[code-diff] --target 형식이 아닙니다: ${argv[i + 1]}  (user@host[:port])`)
    process.exit(1)
  }
  return target
}

/** SSH 프리셋 하나를 접속 대상 문자열로 */
export const presetTarget = (source) =>
  `${source.user}@${source.host}:${source.port ?? 22}`

/** 대상과 같은 서버를 가리키는 SSH 프리셋 (auth 를 확인하려고 찾는다) */
export function findPreset(presets, target) {
  return presets.find((p) => p.source.mode === 'ssh' && presetTarget(p.source) === target)
}

/** 개발 서버에 지금 무엇을 기다리는지 묻는다. 서버가 꺼져 있으면 null */
async function askServer(port) {
  return new Promise((resolve) => {
    const req = require('node:http').request(
      { host: 'localhost', port, path: '/api/v1/ssh-credentials', method: 'GET' },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('error', () => resolve(null)) // 서버가 안 떠 있으면 조용히 설정으로 넘어간다
    req.end()
  })
}

/**
 * 어느 서버의 비밀번호를 받을지 정한다.
 * @returns {{ target: string, from: string, checkAuth: boolean }}
 */
export async function resolveTarget(port, presets, pending) {
  const option = readTargetOption()
  if (option) return { target: option, from: '--target 으로 지정', checkAuth: false }

  // 화면이 기다리는 대상이 가장 정확하다 — 설정 파일보다 우선한다
  if (pending) return { target: pending, from: '화면이 기다리는 접속', checkAuth: false }

  const ssh = presets.filter((p) => p.source.mode === 'ssh')
  if (ssh.length === 0) {
    console.error('[code-diff] change/config.ts 에 SSH 프리셋이 없습니다.')
    process.exit(1)
  }
  if (ssh.length > 1) {
    console.error('[code-diff] SSH 프리셋이 여러 개입니다. --target user@host[:port] 로 지정하세요.')
    console.error('           (화면에서 한 번 접속을 시도하면 그 대상을 기본으로 씁니다)')
    for (const p of ssh) console.error(`             ${p.label}: ${presetTarget(p.source)}`)
    process.exit(1)
  }

  return { target: presetTarget(ssh[0].source), from: 'change/config.ts 의 SSH 프리셋', checkAuth: true }
}

/**
 * 키 인증 설정에 비밀번호를 넣어봐야 쓰이지 않는다 — 넣기 전에 멈춘다.
 * (화면이 비밀번호를 요구한 상태면 이 검사를 하지 않는다. 그때는 화면 쪽 설정이 비밀번호 인증이다)
 */
export function blockedByKeyAuth(preset) {
  return preset !== undefined && preset.source.auth !== 'password'
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

async function main() {
  const port = readPort()
  const status = await askServer(port)
  const { SOURCE_PRESETS } = await import('../change/config.ts')

  const { target, from, checkAuth } = await resolveTarget(port, SOURCE_PRESETS, status?.pending ?? null)

  if (checkAuth && blockedByKeyAuth(findPreset(SOURCE_PRESETS, target))) {
    console.error(
      `[code-diff] ${target} 는 지금 키 인증(auth: 'key')으로 설정돼 있습니다.\n` +
        '           비밀번호를 넣어도 쓰이지 않습니다 (ssh 가 키로만 접속합니다).\n\n' +
        "           비밀번호로 접속하려면 둘 중 하나를 먼저 하세요.\n" +
        "             · change/config.ts 의 해당 프리셋에서 auth 를 'password' 로 바꾼다\n" +
        '             · 화면 ⚙ 위치 에서 인증 방식을 "비밀번호" 로 고른다\n' +
        '           그 뒤 화면에서 한 번 시도하면, 이 명령이 그 접속을 기본 대상으로 씁니다.'
    )
    process.exit(1)
  }

  console.log(`[code-diff] 개발 서버: http://localhost:${port}`)
  console.log(`[code-diff] 접속 대상: ${target}  (${from})`)
  if (!status) {
    console.log('[code-diff] 개발 서버 응답이 없습니다 — 설정 파일 기준으로 진행합니다.')
  }

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
}

// 테스트에서 위 함수들만 가져다 쓸 수 있도록, 직접 실행할 때만 돈다
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
