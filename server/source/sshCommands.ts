import type { SshSourceConfig } from '../../src/types.ts'

/**
 * SSH 명령 조립 — 전부 순수 함수라 실제 접속 없이 테스트한다.
 * 라이브러리 없이 `execFile` 로 OpenSSH 클라이언트를 그대로 실행한다.
 *
 * 로컬 셸은 `execFile` 이 인자 배열을 그대로 넘겨 보간하지 않는다.
 * 반면 마지막 인자(원격 명령)는 **원격 셸이 해석**하므로 경로를 반드시 quote 해야 한다.
 */

/** 원격 셸에서 한 토큰으로 다루도록 작은따옴표로 감싸고 내부 `'` 를 escape 한다 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

// 선행 틸드 세그먼트(~ 또는 ~user, 첫 '/' 전까지). user 는 셸 특수문자 없는 문자셋만 허용해
// 따옴표 밖에 둬도 주입 위험이 없게 한다.
const TILDE_PREFIX = /^(~[A-Za-z0-9._-]*)(\/.*)?$/

/**
 * 원격 경로를 주입에 안전하게 quote 하되, **선행 홈 경로(~)는 원격에서 확장되도록** 따옴표 밖에 둔다.
 * 작은따옴표 안에서는 셸이 `~` 를 확장하지 않아 `'~/rel'` 이 리터럴 경로가 되어 버린다.
 *
 * 뒤쪽만 인용한 `~/'rel'` 로 둔다. POSIX 는 틸드 접두사가 **인용되지 않은 채** 첫 `/` 앞에
 * 있으면 확장한다고 정해 두었고, sh·bash·dash 에서 모두 확장되는 것을 확인했다.
 *
 * `"$HOME"` 을 쓰지 않는다. 오류 안내에 붙는 명령은 **터미널에 그대로 붙여넣을 수 있어야**
 * 하는데, 큰따옴표와 `$` 가 들어가면 감쌀 때 역슬래시 escape 가 생긴다. 윈도우 PowerShell 은
 * 역슬래시를 escape 로 보지 않고 `$HOME` 을 자기가 먼저 풀어 버려서, 붙여넣으면 따옴표가
 * 깨진 채 원격으로 넘어가고 원격 셸이 `unexpected EOF` 로 죽는다.
 */
export function quoteRemotePath(remotePath: string): string {
  const match = TILDE_PREFIX.exec(remotePath)
  if (!match) return shellQuote(remotePath)

  const [, tildePrefix, rest] = match
  if (rest === undefined) return tildePrefix
  // 첫 '/' 는 틸드 접두사를 끝내려고 따옴표 밖에 두고, 그 뒤 실제 경로만 quote 한다
  return `${tildePrefix}/${shellQuote(rest.slice(1))}`
}

/** 원격 경로 두 조각을 잇는다 (`/` 중복·누락 정리) */
export function joinRemote(base: string, ...parts: string[]): string {
  const tail = parts.filter(Boolean).join('/')
  if (!tail) return base
  return `${base.replace(/\/+$/, '')}/${tail}`
}

/**
 * ssh 공통 옵션.
 *
 * **인증은 ssh 에 맡긴다.** 이 도구는 비밀번호를 받지도, 보관하지도, 대신 답하지도 않는다 —
 * 개인키 · ssh-agent · `~/.ssh/config` 로 붙고, 그것으로 안 되면 **ssh 가 직접 물어본다.**
 *
 * `BatchMode` 를 켜지 않는다. 그래서 키가 없는 서버에서는 비밀번호를 물어볼 수 있는데,
 * 그 프롬프트는 화면이 아니라 **개발 서버를 띄운 터미널 창**에 뜬다
 * (OpenSSH 는 비밀번호를 stdin 이 아니라 콘솔에서 직접 읽는다).
 *
 * 접속을 재사용하지 않으므로 **원격 명령마다 한 번씩** 묻는다 — 날짜 목록 한 번에 폴더 수만큼,
 * 좌우 비교 한 번에 파일 수의 두 배다. 아무도 답하지 않으면 `COMMAND_TIMEOUT_MS` 만큼
 * 기다렸다가 실패한다 (sshSource.ts). 프롬프트 없이 쓰려면 공개키를 등록해 두면 된다.
 *
 * - `ConnectTimeout` — 접속 불가일 때 오래 매달리지 않게 한다.
 *   (접속 단계에만 걸리므로 비밀번호 입력 시간을 잘라내지 않는다)
 * - `StrictHostKeyChecking=yes` — 호스트 키를 자동 수락하지 않는다.
 *   처음 접속하는 서버는 터미널에서 한 번 `ssh` 로 접속해 known_hosts 에 등록해야 한다
 *   (자동 수락은 중간자 공격을 못 막는다).
 */
export function sshOptions(conn: SshSourceConfig, connectTimeoutSec = 10): string[] {
  const options: string[] = [
    '-o',
    `ConnectTimeout=${connectTimeoutSec}`,
    '-o',
    'StrictHostKeyChecking=yes',
  ]

  if (conn.port) options.push('-p', String(conn.port))
  if (conn.identityFile) options.push('-i', conn.identityFile)
  return options
}

/** `ssh [...opts] user@host <원격에서 실행할 명령>` 의 argv */
export function buildSshArgs(
  conn: SshSourceConfig,
  remoteCommand: string,
  connectTimeoutSec?: number
): string[] {
  return [...sshOptions(conn, connectTimeoutSec), `${conn.user}@${conn.host}`, remoteCommand]
}

/** 따옴표 없이 셸에 그대로 둬도 되는 문자만. 이 밖이면 감싼다 */
const SAFE_ARG = /^[A-Za-z0-9@%_+=:,./-]+$/

/**
 * argv 한 조각을 사람이 복사해 실행할 수 있는 형태로 만든다.
 * 큰따옴표로 감싸고 로컬 셸이 해석하는 것들(`"` `\` `$` 백틱)만 escape 한다 —
 * 안쪽 작은따옴표(원격 경로 인용)는 그대로 살아 있어야 원격에서 같은 뜻이 된다.
 */
function displayArg(value: string): string {
  return SAFE_ARG.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

/**
 * **실제로 실행한 ssh 명령**을 한 줄로 만든다 (오류 안내에 붙이는 용도).
 *
 * 원격 명령은 이 파일이 조립하므로 화면만 봐서는 무엇이 실행됐는지 알 수 없다.
 * 터미널에 그대로 붙여넣어 재현할 수 있어야 이 도구 문제인지 서버·계정 문제인지 갈린다.
 * (비밀번호는 argv 에 싣지 않으므로 이 문자열로 자격증명이 새어 나가지 않는다)
 */
export function formatSshCommand(args: string[]): string {
  return ['ssh', ...args].map(displayArg).join(' ')
}

/* ------------------------------------------------------------------ */
/* 원격에서 실행할 명령                                                 */
/* ------------------------------------------------------------------ */

/**
 * 루트 바로 아래 항목을 종류 표시와 함께 나열한다.
 * `find -maxdepth` 는 POSIX 가 아니라(Solaris 등에 없다) `ls -1F` 를 쓴다 — 디렉터리에 `/` 가 붙는다.
 */
export const listDirsCommand = (root: string): string => `ls -1F -- ${quoteRemotePath(root)}`

/**
 * 스냅샷 안의 모든 파일을 **크기와 함께** 나열한다.
 * `find -printf` 나 `stat -c` 는 GNU 전용이라, POSIX 조합인 `find ... -exec wc -c {} +` 를 쓴다.
 * 출력은 `<바이트수> ./<상대경로>` 이고 배치마다 `total` 줄이 섞인다 (호출부에서 걸러낸다).
 *
 * **먼저 폴더로 들어가 `find .` 을 돌린다.** 절대 경로를 넘기면 find 가 그 경로를 그대로 앞에
 * 붙여 내보내는데, `~/rel` 처럼 원격이 확장하는 루트에서는 돌아온 경로(`/home/deploy/rel/…`)와
 * 우리가 아는 문자열(`~/rel/…`)이 달라 목록이 통째로 걸러진다 — 접속도 되고 폴더도 보이는데
 * 파일만 0개로 보이는, 원인을 찾기 어려운 실패였다. `./` 로 받으면 확장 결과를 몰라도 된다.
 *
 * `|| true` 로 **항상 정상 종료**시킨다 — 빈 폴더(find 가 아무것도 못 찾음)와
 * 접속 실패를 종료 코드로 구분해야 하기 때문. 이게 없으면 접속이 끊겨도 "빈 폴더"로 보인다.
 */
export const listFilesCommand = (snapshotDir: string): string =>
  `cd ${quoteRemotePath(snapshotDir)} 2>/dev/null && find . -type f -exec wc -c {} + 2>/dev/null || true`

/**
 * 여러 파일의 본문을 **한 번의 접속으로** 읽는다.
 *
 * 접속을 재사용할 수 없으므로(README: Windows 기본 OpenSSH 는 다중화를 못 한다)
 * 파일마다 `ssh` 를 띄우면 왕복이 파일 수에 비례한다. 그래서 한 명령에 몰아 넣는다.
 *
 * 출력은 **파일마다 `@@<바이트수>` 한 줄 + 그 바이트 수만큼의 본문**이다.
 * 구분자를 본문에서 찾지 않고 **길이만큼 잘라 읽으므로** 내용이 무엇이든 안 깨진다
 * (본문 안에 `@@` 가 있어도 상관없다). 없는 파일은 `@@-` 한 줄만 나온다 —
 * 그래야 요청한 순서와 결과가 어긋나지 않는다. 경로는 출력에 싣지 않는다:
 * 이름에 무엇이 들어 있든 파싱이 흔들릴 자리가 없다.
 *
 * `$` · 백틱 · 역슬래시를 쓰지 않는다. 이 명령이 오류 안내에 그대로 붙는데,
 * 그 문자들이 있으면 `formatSshCommand` 가 escape 를 붙여 PowerShell 에 붙여넣을 수
 * 없는 명령이 된다 (`quoteRemotePath` 주석과 같은 이유).
 */
const fileFragment = (relPath: string): string => {
  // `./` 를 붙여 `-` 로 시작하는 이름이 옵션으로 읽히지 않게 한다
  const quoted = shellQuote(`./${relPath}`)
  return `if [ -f ${quoted} ]; then printf '@@'; wc -c < ${quoted}; cat -- ${quoted}; else echo '@@-'; fi`
}

export const readFilesCommand = (snapshotDir: string, relPaths: readonly string[]): string =>
  `cd ${quoteRemotePath(snapshotDir)} 2>/dev/null || exit 0; ${relPaths.map(fileFragment).join('; ')}`

/** 원격 명령 한 줄의 길이 상한. 가장 빡빡한 ARG_MAX(Solaris 1MB)를 넉넉히 밑돈다 */
const MAX_COMMAND_CHARS = 60_000
/** 한 번에 받을 파일 수 상한 — 응답이 `MAX_BUFFER` 를 넘지 않게 한다 (sshSource.ts) */
const MAX_FILES_PER_COMMAND = 200

/**
 * `readFilesCommand` 에 넘길 수 있는 크기로 경로를 나눈다.
 * 명령 길이(ARG_MAX)와 응답 크기(maxBuffer) 둘 다에 상한이 있어서 둘 다 본다.
 */
export function chunkPaths(relPaths: readonly string[]): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let length = 0

  for (const relPath of relPaths) {
    const added = fileFragment(relPath).length + 2 // 연결자 `; `
    if (current.length > 0 && (current.length >= MAX_FILES_PER_COMMAND || length + added > MAX_COMMAND_CHARS)) {
      chunks.push(current)
      current = []
      length = 0
    }
    current.push(relPath)
    length += added
  }

  if (current.length > 0) chunks.push(current)
  return chunks
}



/* ------------------------------------------------------------------ */
/* 출력 파싱                                                            */
/* ------------------------------------------------------------------ */

/**
 * `ls -1F` 출력에서 디렉터리 이름만 뽑는다.
 * `-F` 는 디렉터리에 `/`, 실행파일에 `*`, 심볼릭 링크에 `@` 를 붙인다.
 * 심볼릭 링크는 루트 밖을 가리킬 수 있어 로컬 구현과 마찬가지로 따라가지 않는다.
 */
export function parseDirListing(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.endsWith('/'))
    .map((line) => line.slice(0, -1))
    .filter((name) => name !== '' && name !== '.' && name !== '..')
}

/**
 * `wc -c` 출력을 상대 경로 + 크기로 바꾼다.
 *
 * 각 줄은 `<바이트수> ./<상대경로>` 이고, 파일이 여러 개면 `<합계> total` 줄이 섞인다.
 * `./` 로 시작하는 줄만 인정해 `total` 줄과 잡음을 함께 걸러낸다
 * (`listFilesCommand` 가 폴더 안으로 들어가 `find .` 을 돌리므로 항상 `./` 로 온다).
 * 경로에 공백이 있어도 첫 공백 뒤 전부를 경로로 보므로 안전하다.
 */
export function parseFileSizes(stdout: string): { path: string; size: number }[] {
  const out: { path: string; size: number }[] = []

  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '').trim()
    if (!line) continue

    const gap = line.indexOf(' ')
    if (gap <= 0) continue

    const size = Number(line.slice(0, gap))
    if (!Number.isFinite(size)) continue

    const found = line.slice(gap + 1).trimStart()
    if (!found.startsWith('./')) continue // `total` 줄과 잡음을 걸러낸다

    const relative = found.slice(2)
    if (relative) out.push({ path: relative, size })
  }
  return out
}

/**
 * `readFilesCommand` 의 출력을 요청한 순서대로 파일 본문(바이트)으로 자른다.
 *
 * **바이트로 다룬다.** 헤더의 숫자는 바이트 수라, 문자열로 옮긴 뒤에는 (EUC-KR·UTF-8)
 * 그 길이만큼 자를 수가 없다. 디코딩은 잘라낸 다음에 한다.
 *
 * 어긋나면 **그 자리에서 멈춘다.** 헤더가 `@@` 로 시작하지 않거나 남은 바이트가
 * 모자라면 나머지는 전부 "없음"으로 둔다 — 어긋난 바이트를 본문으로 넘기면
 * 엉뚱한 파일 내용이 diff 에 올라가 조용히 틀린 결과가 된다.
 *
 * @param count 요청한 파일 수. 반환 배열의 길이는 항상 이 값이다 (없는 파일은 null)
 */
export function parseFileStream(bytes: Uint8Array, count: number): (Uint8Array | null)[] {
  const AT = 0x40 // '@'
  const LF = 0x0a
  const out: (Uint8Array | null)[] = []
  let pos = 0

  while (out.length < count) {
    if (bytes[pos] !== AT || bytes[pos + 1] !== AT) break

    let eol = pos + 2
    while (eol < bytes.length && bytes[eol] !== LF) eol++
    if (eol >= bytes.length) break

    // `wc -c` 는 구현에 따라 숫자 앞에 공백을 채운다 (`      42`)
    const header = new TextDecoder().decode(bytes.subarray(pos + 2, eol)).trim()
    pos = eol + 1

    if (header === '-') {
      out.push(null)
      continue
    }

    const size = Number(header)
    if (!Number.isInteger(size) || size < 0 || pos + size > bytes.length) break

    out.push(bytes.subarray(pos, pos + size))
    pos += size
  }

  while (out.length < count) out.push(null)
  return out
}
