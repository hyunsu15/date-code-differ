import { execFile, type ExecException } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeRelativePath } from '../../src/lib/fileTypes.ts'
import {
  connectionKey,
  forgetPassword,
  getPassword,
  setPendingConnection,
} from './passwordStore.ts'
import {
  buildSshArgs,
  existsCommand,
  joinRemote,
  listDirsCommand,
  listFilesCommand,
  parseDirListing,
  parseFileSizes,
  readFileCommand,
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
/** 원격 명령 하나가 매달릴 수 있는 최대 시간 */
const COMMAND_TIMEOUT_MS = 30_000

/**
 * ssh 가 비밀번호를 물어볼 때 대신 답하는 프로그램.
 *
 * OpenSSH 는 비밀번호를 stdin 이 아니라 제어 터미널에서 읽으므로 파이프로 넣을 수 없다.
 * `SSH_ASKPASS` 는 그걸 우회하는 **OpenSSH 자체 기능**이라 외부 라이브러리가 필요 없다.
 * 인자를 넘길 수 없어 플랫폼별 래퍼 스크립트를 둔다.
 */
const ASKPASS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts',
  process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh'
)

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

  async exists(): Promise<boolean> {
    // 접속 실패는 삼키지 않고 그대로 던진다. "접속이 안 됨"을 "경로가 없음"으로
    // 안내하면 사용자가 엉뚱한 곳을 고치게 된다.
    // (명령 자체는 경로가 없어도 정상 종료하므로, 여기서 실패 = 접속·인증 문제다)
    const out = await this.run(existsCommand(this.conn.root))
    return this.decode(out).includes('__OK__')
  }

  async listSnapshotDirs(): Promise<string[]> {
    const out = await this.run(listDirsCommand(this.conn.root))
    return parseDirListing(this.decode(out))
  }

  async listFiles(snapshotId: string): Promise<RawFile[]> {
    if (!isValidSnapshotId(snapshotId)) return []
    const dir = joinRemote(this.conn.root, snapshotId)
    // 명령이 빈 폴더에서도 정상 종료하므로(`|| true`), 여기서 실패 = 접속 문제다.
    // 삼키면 접속 끊김이 "빈 폴더"로 보여 비교 결과가 조용히 비어 버린다.
    const out = await this.run(listFilesCommand(dir))
    return parseFileSizes(this.decode(out), dir)
  }

  async readFile(snapshotId: string, relPath: string): Promise<string | null> {
    if (!isValidSnapshotId(snapshotId)) return null

    const safe = safeRelativePath(relPath)
    if (!safe) return null

    const target = joinRemote(this.conn.root, snapshotId, safe)
    const out = await this.run(readFileCommand(target), { allowFailure: true })
    return out === null ? null : this.decode(out)
  }

  /** 원격 바이트를 설정한 인코딩으로 옮긴다. 파일명도 같은 규칙으로 읽는다 */
  private decode(bytes: Buffer | null): string {
    return bytes === null ? '' : decodeText(bytes, this.conn.encoding)
  }

  /**
   * 비밀번호 인증에 쓸 환경변수.
   *
   * 비밀번호는 **환경변수로만** 넘긴다. 명령줄 인자에 넣으면 `ps` 로 다른 사용자에게 보인다.
   * `SSH_ASKPASS_REQUIRE=force` 가 있어야 터미널이 붙어 있어도 askpass 를 쓴다.
   */
  private askpassEnv(): NodeJS.ProcessEnv | undefined {
    if (this.conn.auth !== 'password') return undefined

    const password = getPassword(connectionKey(this.conn))
    if (password === undefined) return undefined

    return {
      ...process.env,
      SSH_ASKPASS: ASKPASS,
      SSH_ASKPASS_REQUIRE: 'force',
      CODE_DIFF_SSH_PASSWORD: password,
    }
  }

  /**
   * 원격 명령 실행.
   * @param allowFailure 참이면 실패를 null 로 돌려준다 (없는 파일 등 정상 흐름)
   */
  private run(
    remoteCommand: string,
    { allowFailure = false }: { allowFailure?: boolean } = {}
  ): Promise<Buffer | null> {
    // 비밀번호 인증인데 아직 비밀번호가 없으면, 물어보다 멈추지 말고 바로 알린다
    if (this.conn.auth === 'password' && !getPassword(connectionKey(this.conn))) {
      // 화면이 실제로 쓰는 대상을 남긴다 — ssh-login 이 config 대신 이 서버를 기본으로 묻는다
      setPendingConnection(connectionKey(this.conn))
      return Promise.reject(
        new SourceError(
          `${connectionKey(this.conn)} 의 비밀번호가 없습니다.\n` +
            '터미널에서 `npm run ssh-login` 을 실행해 입력한 뒤 다시 시도하세요.',
          'SSH_PASSWORD_REQUIRED'
        )
      )
    }

    const args = buildSshArgs(this.conn, remoteCommand)
    const env = this.askpassEnv()

    // 인코딩을 여기서 정하지 않고 바이트로 받는다 — 파일 내용이 EUC-KR 일 수 있어서
    // 문자열 변환은 decode() 에서 설정에 맞춰 한 번만 한다.
    return new Promise((resolve, reject) => {
      execFile(
        'ssh',
        args,
        { maxBuffer: MAX_BUFFER, timeout: COMMAND_TIMEOUT_MS, encoding: 'buffer', env },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout)
            return
          }
          if (allowFailure) {
            resolve(null)
            return
          }
          // stderr 는 ssh 자체 메시지라 항상 UTF-8 로 본다
          reject(toSourceError(error, stderr.toString('utf8'), this.conn))
        }
      )
    })
  }
}

/** ssh 실패를 화면에 그대로 보여줄 수 있는 안내로 바꾼다 */
function toSourceError(
  error: ExecException,
  stderr: string,
  conn: SshSourceConfig
): SourceError {
  if (error.code === 'ENOENT') {
    return new SourceError(
      'ssh 명령을 찾을 수 없습니다. OpenSSH 클라이언트가 설치돼 있고 PATH 에 있는지 확인하세요.',
      'SSH_NOT_FOUND'
    )
  }

  const detail = stderr.trim() || error.message

  if (/Permission denied|publickey|password|Authentication failed/i.test(detail)) {
    if (conn.auth === 'password') {
      // 틀린 비밀번호를 계속 들고 있으면 같은 실패를 반복한다 — 지워서 다시 받게 한다
      forgetPassword(connectionKey(conn))
      setPendingConnection(connectionKey(conn))
      return new SourceError(
        '비밀번호 인증에 실패했습니다.\n' +
          '터미널에서 `npm run ssh-login` 으로 다시 입력하세요.\n\n' +
          detail,
        'SSH_PASSWORD_REJECTED'
      )
    }
    return new SourceError(
      `키 인증에 실패했습니다. 개인키 경로와 원격 계정을 확인하세요.\n` +
        `비밀번호로 접속해야 한다면 프리셋의 auth 를 'password' 로 바꾸세요.\n\n${detail}`,
      'SSH_AUTH_FAILED'
    )
  }
  if (/Host key verification failed|known_hosts/i.test(detail)) {
    return new SourceError(
      `호스트 키가 등록돼 있지 않습니다. 터미널에서 한 번 접속해 known_hosts 에 추가한 뒤 다시 시도하세요.\n\n${detail}`,
      'SSH_HOST_KEY'
    )
  }
  if (/Could not resolve hostname|Connection refused|Connection timed out|No route to host/i.test(detail)) {
    return new SourceError(`원격 서버에 접속하지 못했습니다.\n\n${detail}`, 'SSH_UNREACHABLE')
  }

  return new SourceError(`원격 명령이 실패했습니다.\n\n${detail}`, 'SSH_FAILED')
}
