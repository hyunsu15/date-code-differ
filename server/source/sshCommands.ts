import type { SshSourceConfig } from '../../src/types.ts'

/**
 * SSH 명령 조립 — 전부 순수 함수라 실제 접속 없이 테스트한다.
 * (`RealSshClient.ts` 의 방식을 따랐다: 라이브러리 없이 `execFile` 로 `ssh` 실행)
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
 * 내 홈은 `"$HOME"` 으로 바꾼다 — 틸드는 인용에 인접하면 셸마다 확장 규칙이 다르지만
 * `"$HOME"` 은 sh·bash·ksh·zsh·csh 모두 큰따옴표 안에서 확장된다.
 * `~user` 는 `$HOME` 으로 대체할 수 없어 틸드 노출을 유지한다(안전 문자셋 한정).
 */
export function quoteRemotePath(remotePath: string): string {
  const match = TILDE_PREFIX.exec(remotePath)
  if (!match) return shellQuote(remotePath)

  const [, tildePrefix, rest] = match
  const homePrefix = tildePrefix === '~' ? '"$HOME"' : tildePrefix
  if (rest === undefined) return homePrefix
  // 첫 '/' 는 확장 세그먼트를 끝내려고 따옴표 밖에 두고, 그 뒤 실제 경로만 quote 한다
  return `${homePrefix}/${shellQuote(rest.slice(1))}`
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
 * - `ConnectTimeout` — 접속 불가일 때 오래 매달리지 않게 한다.
 * - `StrictHostKeyChecking=yes` — 호스트 키를 자동 수락하지 않고, 묻지도 않는다.
 *   처음 접속하는 서버는 터미널에서 한 번 `ssh` 로 접속해 known_hosts 에 등록해야 한다
 *   (자동 수락은 중간자 공격을 못 막는다).
 *   **묻지 않는 것까지 중요하다** — 비밀번호 인증에서는 ssh 의 모든 질문이 askpass 로 가는데,
 *   askpass 는 문구를 보지 않고 비밀번호를 답한다. 호스트 키 확인이 뜨면 그 질문에
 *   비밀번호가 답으로 들어가고, 접속은 원인 모를 실패로 끝난다.
 *
 * 인증 방식에 따라 갈린다.
 *
 * **키 인증** — `BatchMode=yes`. 무엇도 묻지 않고 실패하면 바로 끝난다.
 *   이게 없으면 프롬프트가 떠서 개발 서버가 통째로 멈춘다.
 *
 * **비밀번호 인증** — `BatchMode` 를 켤 수 없다(켜면 askpass 도 막힌다).
 *   대신 이렇게 막아 둔다.
 *   · `PubkeyAuthentication=no` — 키를 먼저 시도하다 키 암호를 묻는 일을 없앤다
 *   · `NumberOfPasswordPrompts=1` — 틀리면 3번 재시도하지 않고 바로 실패한다
 *   실제 비밀번호는 `SSH_ASKPASS` 로 전달한다 (sshSource.ts 참고).
 */
export function sshOptions(conn: SshSourceConfig, connectTimeoutSec = 10): string[] {
  const options: string[] = [
    '-o',
    `ConnectTimeout=${connectTimeoutSec}`,
    // 호스트 키를 자동 수락하지도, **물어보지도** 않는다.
    // 물어보게 두면 비밀번호 인증에서 그 질문이 askpass 로 가고,
    // askpass 는 비밀번호를 답으로 내놓는다 (yes/no 질문에 비밀번호가 들어간다).
    '-o',
    'StrictHostKeyChecking=yes',
  ]

  if (conn.auth === 'password') {
    options.push(
      '-o',
      'BatchMode=no',
      '-o',
      'PubkeyAuthentication=no',
      '-o',
      'PreferredAuthentications=password,keyboard-interactive',
      '-o',
      'NumberOfPasswordPrompts=1'
    )
  } else {
    options.push('-o', 'BatchMode=yes')
  }

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
 * 출력은 `<바이트수> <절대경로>` 이고 배치마다 `total` 줄이 섞인다 (호출부에서 걸러낸다).
 *
 * `|| true` 로 **항상 정상 종료**시킨다 — 빈 폴더(find 가 아무것도 못 찾음)와
 * 접속 실패를 종료 코드로 구분해야 하기 때문. 이게 없으면 접속이 끊겨도 "빈 폴더"로 보인다.
 */
export const listFilesCommand = (snapshotDir: string): string =>
  `find ${quoteRemotePath(snapshotDir)} -type f -exec wc -c {} + 2>/dev/null || true`

/** 파일 본문 — 내려받지 않고 표준출력으로 읽는다 */
export const readFileCommand = (filePath: string): string => `cat -- ${quoteRemotePath(filePath)}`

/**
 * 루트가 디렉터리인지 확인.
 * 결과를 **종료 코드가 아니라 표준출력으로** 알린다 — 명령은 항상 정상 종료해야
 * "접속 실패"와 "경로 없음"을 구분할 수 있다 (`test -d X && echo` 는 경로가 없으면 exit 1 이라
 * 접속 실패와 똑같이 보인다).
 */
export const existsCommand = (root: string): string =>
  `if test -d ${quoteRemotePath(root)}; then echo __OK__; else echo __NO__; fi`

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
 * 각 줄은 `<바이트수> <절대경로>` 이고, 파일이 여러 개면 `<합계> total` 줄이 섞인다.
 * 경로가 `snapshotDir` 로 시작하는 줄만 인정해 `total` 줄과 잡음을 함께 걸러낸다.
 * (경로에 공백이 있어도 첫 공백 뒤 전부를 경로로 보므로 안전하다)
 */
export function parseFileSizes(stdout: string, snapshotDir: string): { path: string; size: number }[] {
  const prefix = `${snapshotDir.replace(/\/+$/, '')}/`
  const out: { path: string; size: number }[] = []

  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/, '').trim()
    if (!line) continue

    const gap = line.indexOf(' ')
    if (gap <= 0) continue

    const size = Number(line.slice(0, gap))
    if (!Number.isFinite(size)) continue

    const absolute = line.slice(gap + 1).trimStart()
    if (!absolute.startsWith(prefix)) continue // `total` 줄과 범위 밖 경로를 걸러낸다

    const relative = absolute.slice(prefix.length)
    if (relative) out.push({ path: relative, size })
  }
  return out
}
