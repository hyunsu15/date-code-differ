import { execFile, type ExecException } from 'node:child_process'
import { safeRelativePath } from '../../src/lib/fileTypes.ts'
import {
  buildSshArgs,
  chunkPaths,
  chunkSnapshotIds,
  formatSshCommand,
  joinRemote,
  listDirsCommand,
  listFilesCommand,
  parseDirListing,
  parseFileListing,
  groupBySnapshot,
  parseFileEntries,
  parseFileStream,
  readFilesCommand,
  readTextFileCommand,
} from './sshCommands.ts'
import { decodeText } from './decode.ts'
import { SourceError, type RawFile, type SnapshotSource } from './types.ts'
import type { SshSourceConfig } from '../../src/types.ts'

/**
 * SSH 로 원격 폴더를 읽는 소스. **읽기만 하고 내려받지 않는다** (`cat` 으로 표준출력을 받는다).
 * 라이브러리 없이 `execFile('ssh', ...)` 로 실행한다 — 인자 배열이라 로컬 셸 보간이 없다.
 */

/** 파일 목록이 길어도 잘리지 않도록 넉넉히 잡는다 (기본 1MB 는 금방 넘는다) */
const MAX_BUFFER = 64 * 1024 * 1024
/**
 * 원격 명령 하나가 매달릴 수 있는 최대 시간.
 *
 * `BatchMode` 를 켜지 않으므로 ssh 가 개발 서버 터미널에 비밀번호를 물어볼 수 있다.
 * 이 시간은 **그 입력을 기다리는 시간까지 포함**한다 — 아무도 답하지 않으면 여기서 끊긴다.
 */
const COMMAND_TIMEOUT_MS = 30_000

/** ssh 자신의 실패(접속·인증·호스트 키)를 알리는 종료 코드. 원격 명령의 코드와 겹치지 않는다 (ssh(1)) */
const SSH_ERROR_EXIT = 255

/** 스냅샷 폴더명으로 쓸 수 있는지 — 경로 구분자·상위 이동을 막는다 */
const isValidSnapshotId = (id: string): boolean =>
  id !== '' && !id.includes('/') && !id.includes('\\') && id !== '.' && id !== '..'

export class SshSource implements SnapshotSource {
  private readonly conn: SshSourceConfig

  constructor(conn: SshSourceConfig) {
    this.conn = conn
  }

  describe(): string {
    const port = this.conn.port ? `:${this.conn.port}` : ''
    return `${this.conn.user}@${this.conn.host}${port} ${this.conn.root}`
  }

  async listSnapshotDirs(): Promise<string[]> {
    // 루트를 훑는 첫 명령이라 여기서 "폴더 없음"이 드러난다. `ls` 가 원격에서 실패했다면
    // 루트를 읽지 못한 것이고(없거나 권한이 없거나), ssh 자신의 실패(255)는 접속 문제다 —
    // run() 이 종료 코드로 둘을 갈라 준다.
    const out = await this.run(listDirsCommand(this.conn.root), { rootFailureCode: 'ROOT_NOT_FOUND' })
    return parseDirListing(this.decode(out))
  }

  /**
   * 요청한 스냅샷을 **한 명령으로** 훑는다.
   * 폴더마다 물어보면 날짜 목록 한 번에 접속이 폴더 수만큼 일어난다.
   */
  async listFilesIn(snapshotIds: readonly string[]): Promise<Map<string, RawFile[]>> {
    const out = new Map<string, RawFile[]>()
    const valid = snapshotIds.filter(isValidSnapshotId)

    for (const chunk of chunkSnapshotIds(valid)) {
      // 명령이 빈 폴더에서도 정상 종료하므로(`|| true`), 여기서 실패 = 접속 문제다.
      // 삼키면 접속 끊김이 "빈 폴더"로 보여 비교 결과가 조용히 비어 버린다.
      const listed = await this.run(listFilesCommand(this.conn.root, chunk))
      const grouped = groupBySnapshot(parseFileEntries(this.decode(listed)), chunk)
      for (const [id, files] of grouped) out.set(id, files)
    }

    return out
  }

  /**
   * 요청한 파일들을 **경로 수가 아니라 명령 수에 비례하는** 왕복으로 읽는다.
   * 한 번에 다 넣을 수 없는 양이면 `chunkPaths` 가 나눈 만큼만 접속한다.
   */
  async readFiles(snapshotId: string, relPaths: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    if (!isValidSnapshotId(snapshotId)) return out

    // 정규화 전후를 짝지어 둔다 — 결과는 **호출부가 물어본 경로**로 돌려줘야 한다.
    // 같은 파일을 두 번 물어보면 원격에는 한 번만 묻고 양쪽에 같은 본문을 준다.
    const askedBySafe = new Map<string, string[]>()
    for (const relPath of relPaths) {
      const safe = safeRelativePath(relPath)
      if (!safe) continue
      const found = askedBySafe.get(safe)
      if (found) found.push(relPath)
      else askedBySafe.set(safe, [relPath])
    }
    if (askedBySafe.size === 0) return out

    const dir = joinRemote(this.conn.root, snapshotId)
    for (const chunk of chunkPaths([...askedBySafe.keys()])) {
      // 없는 파일은 출력 안에서 `@@-` 로 구분되므로, 여기서 실패 = 접속 문제다
      const stream = await this.run(readFilesCommand(dir, chunk))
      const bodies = parseFileStream(stream ?? new Uint8Array(), chunk.length)

      chunk.forEach((safe, i) => {
        const body = bodies[i]
        if (!body) return
        const text = decodeText(body, this.conn.encoding)
        for (const asked of askedBySafe.get(safe) ?? []) out.set(asked, text)
      })
    }

    return out
  }

  /**
   * 스냅샷 밖의 텍스트 파일 한 건 (제외 목록).
   * 없는 파일은 출력 안에서 `@@-` 로 구분되므로, 여기서 실패 = 접속 문제다.
   */
  async readTextFile(target: string): Promise<string | null> {
    const stream = await this.run(readTextFileCommand(target))
    const [body] = parseFileStream(stream ?? new Uint8Array(), 1)
    return body === null ? null : decodeText(body, this.conn.encoding)
  }

  /**
   * 스냅샷 밖 폴더의 파일 이름 목록 (스키마 덤프 폴더).
   *
   * 폴더가 없으면 원격 `ls` 가 실패하는데, 그것이 **정상 흐름**이다 — 설정을 아직
   * 안 채웠거나 그 환경에 스키마를 안 올린 경우다. 빈 목록으로 돌려준다.
   */
  async listFileNames(dir: string): Promise<string[]> {
    const out = await this.run(listDirsCommand(dir), { allowExitFailure: true })
    return out === null ? [] : parseFileListing(this.decode(out))
  }

  /** 원격 바이트를 설정한 인코딩으로 옮긴다. 파일명도 같은 규칙으로 읽는다 */
  private decode(bytes: Buffer | null): string {
    return bytes === null ? '' : decodeText(bytes, this.conn.encoding)
  }

  /**
   * 원격 명령 실행.
   *
   * 종료 코드로 **원격의 대답**과 **ssh 자신의 실패**를 가른다. ssh 는 원격 명령의 코드를
   * 그대로 돌려주고 자기 실패는 255 로 알린다(ssh(1)) — 접속이 끊긴 것을 "파일이 없다"로
   * 안내하면 사용자가 엉뚱한 곳을 고치게 되므로, 이 구분이 없으면 안 된다.
   *
   * @param allowExitFailure 원격 명령이 실패하는 것이 **정상 흐름**이면 참 (없는 파일). null 을 돌려준다
   * @param rootFailureCode 원격 명령이 실패했을 때 붙일 오류 코드 (루트를 읽는 명령용)
   */
  private run(
    remoteCommand: string,
    {
      allowExitFailure = false,
      rootFailureCode,
    }: { allowExitFailure?: boolean; rootFailureCode?: string } = {}
  ): Promise<Buffer | null> {
    const args = buildSshArgs(this.conn, remoteCommand)

    // 인코딩을 여기서 정하지 않고 바이트로 받는다 — 파일 내용이 EUC-KR 일 수 있어서
    // 문자열 변환은 decode() 에서 설정에 맞춰 한 번만 한다.
    return new Promise((resolve, reject) => {
      execFile(
        'ssh',
        args,
        { maxBuffer: MAX_BUFFER, timeout: COMMAND_TIMEOUT_MS, encoding: 'buffer' },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout)
            return
          }
          const remote = isRemoteExitCode(error.code)
          if (allowExitFailure && remote) {
            resolve(null)
            return
          }
          const failure = toSourceError(error, decodeSshMessage(stderr), formatSshCommand(args))
          reject(
            rootFailureCode && remote ? new SourceError(failure.message, rootFailureCode) : failure
          )
        }
      )
    })
  }
}

/**
 * 종료 코드가 **원격 명령이 낸 것**인지. ssh 는 원격 명령의 코드를 그대로 돌려주고
 * 자기 실패는 SSH_ERROR_EXIT 으로 알린다. 숫자가 아니면 ssh 실행 자체가 실패한 것
 * (`ENOENT`)이거나 시간 초과로 우리가 죽인 것이다 — 둘 다 원격의 대답이 아니다.
 */
function isRemoteExitCode(code: ExecException['code']): boolean {
  return typeof code === 'number' && code !== SSH_ERROR_EXIT
}

/** OpenSSH 가 ASCII 밖 바이트를 바꿔 놓는 8진 escape 의 연속 (`\276\313` …) */
const VIS_ESCAPES = /(?:\\[0-3][0-7]{2})+/g

/**
 * ssh 가 내보낸 오류 문구를 읽을 수 있게 만든다.
 *
 * OpenSSH 는 출력하기 전에 ASCII 밖 바이트를 `\nnn`(8진) **리터럴 문자열**로 바꿔 놓는다.
 * 한국어 윈도우에서는 OS 가 준 CP949 한글 메시지가 통째로 그렇게 escape 되어
 * `\276\313\267\301…` 으로 보인다 — 인코딩만 바꿔 읽어서는 풀리지 않는다.
 * 되돌린 다음 디코딩한다 (연속된 escape 가 한 글자를 이루므로 이어붙여 한 번에 옮긴다).
 */
export function decodeSshMessage(bytes: Uint8Array): string {
  return decodeText(bytes, 'auto').replace(VIS_ESCAPES, (run) =>
    decodeText(
      Uint8Array.from(run.slice(1).split('\\'), (octal) => parseInt(octal, 8)),
      'auto'
    )
  )
}

/**
 * ssh 실패를 화면에 그대로 보여줄 수 있는 안내로 바꾼다.
 *
 * **실행한 명령을 항상 붙인다.** 원격 명령을 이 도구가 조립하므로, 명령을 안 보여주면
 * 사용자는 무엇이 실패했는지 모른 채 추측만 하게 된다. 붙여넣어 재현할 수 있어야
 * 이 도구 문제인지 서버·계정 문제인지 가른다.
 */
export function toSourceError(error: ExecException, stderr: string, command: string): SourceError {
  const { message, code } = explainFailure(error, stderr)
  return new SourceError(`${message}\n\n실행한 명령:\n${command}`, code)
}

/** 실패 원인별 안내문. 명령 표시는 toSourceError 가 붙인다 */
function explainFailure(error: ExecException, stderr: string): { message: string; code: string } {
  if (error.code === 'ENOENT') {
    return {
      code: 'SSH_NOT_FOUND',
      message:
        'ssh 명령을 찾을 수 없습니다. OpenSSH 클라이언트가 설치돼 있고 PATH 에 있는지 확인하세요.',
    }
  }

  // 시간 초과는 stderr 가 비어 있다. error.message 에 argv 가 통째로 들어 있어
  // 그대로 쓰면 명령이 두 번 찍히므로 여기서 따로 문장을 만든다.
  if (error.killed) {
    return {
      code: 'SSH_TIMEOUT',
      message:
        `${COMMAND_TIMEOUT_MS / 1000}초 동안 응답이 없어 끊었습니다.\n` +
        'ssh 가 개발 서버를 띄운 터미널 창에서 비밀번호를 기다리고 있을 수 있습니다 — 그 창을 확인하세요.',
    }
  }

  // stderr 는 ssh 자체 메시지라 항상 UTF-8 로 본다
  const detail = stderr.trim() || error.message

  if (/Permission denied|publickey|password|Authentication failed/i.test(detail)) {
    return {
      code: 'SSH_AUTH_FAILED',
      message:
        '인증에 실패했습니다.\n' +
        '이 도구는 비밀번호를 묻지 않습니다 — ssh 가 평소 쓰는 방식(개인키 · ssh-agent · ~/.ssh/config)으로 붙습니다.\n' +
        '아래 명령을 터미널에 그대로 붙여넣어 아무것도 묻지 않고 들어가는지 먼저 확인하세요.\n' +
        '(비밀번호로만 들어가는 서버라면 `ssh-copy-id` 로 공개키를 등록해 두면 됩니다)\n\n' +
        detail,
    }
  }
  if (/Host key verification failed|known_hosts/i.test(detail)) {
    return {
      code: 'SSH_HOST_KEY',
      message: `호스트 키가 등록돼 있지 않습니다. 터미널에서 한 번 접속해 known_hosts 에 추가한 뒤 다시 시도하세요.\n\n${detail}`,
    }
  }
  if (/Could not resolve hostname|Connection refused|Connection timed out|No route to host/i.test(detail)) {
    return { code: 'SSH_UNREACHABLE', message: `원격 서버에 접속하지 못했습니다.\n\n${detail}` }
  }

  return { code: 'SSH_FAILED', message: `원격 명령이 실패했습니다.\n\n${detail}` }
}
