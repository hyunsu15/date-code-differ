import type { SshSourceConfig } from '../../src/types.ts'

/**
 * SSH 비밀번호 보관소.
 *
 * **개발 서버 프로세스 메모리에만** 둔다. 파일·localStorage·URL 어디에도 쓰지 않는다.
 * 서버를 끄면 사라지고, 브라우저는 비밀번호를 보지 못한다.
 * 값은 터미널에서 `npm run ssh-login` 으로만 들어온다.
 */

/** 접속 하나를 가리키는 키 — 같은 서버·계정이면 같은 비밀번호를 쓴다 */
export function connectionKey(conn: Pick<SshSourceConfig, 'user' | 'host' | 'port'>): string {
  return `${conn.user}@${conn.host}:${conn.port ?? 22}`
}

/**
 * 사람이 적은 `user@host[:port]` 를 위 키와 **같은 형태**로 맞춘다. 형식이 아니면 null.
 *
 * 포트를 생략하면 22 로 채운다 — `--target user@host` 로 넣은 비밀번호가
 * `user@host:22` 를 찾는 화면에서 안 보이는 일을 막는다 (같은 서버인데 키가 어긋난다).
 */
export function normalizeConnectionTarget(raw: string): string | null {
  const value = raw.trim()

  const at = value.indexOf('@')
  if (at <= 0) return null
  const user = value.slice(0, at)
  const rest = value.slice(at + 1)
  if (/[\s@]/.test(user) || rest === '') return null

  const colon = rest.lastIndexOf(':')
  const host = colon >= 0 ? rest.slice(0, colon) : rest
  const portText = colon >= 0 ? rest.slice(colon + 1) : '22'
  if (host === '' || /[\s:@]/.test(host)) return null

  const port = Number(portText)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null

  return `${user}@${host}:${port}`
}

const passwords = new Map<string, string>()

/**
 * 지금 비밀번호를 기다리는 접속 대상.
 *
 * 화면이 쓰는 대상은 `change/config.ts` 의 프리셋과 다를 수 있다 (직접 입력·프리셋이 여러 개).
 * 그러면 `npm run ssh-login` 이 엉뚱한 서버로 비밀번호를 넣어, 넣었는데도
 * "비밀번호가 없습니다" 가 계속 뜬다. 그 어긋남을 없애려고 **대상만** 기억한다.
 * 비밀번호는 여기에 담기지 않는다.
 */
let pending: string | null = null

/** 비밀번호가 없거나 틀려서 막혔을 때, 어느 접속이었는지 남긴다 */
export function setPendingConnection(key: string): void {
  pending = key
}

/** `npm run ssh-login` 이 물어볼 기본 대상 */
export function pendingConnection(): string | null {
  return pending
}

export function setPassword(key: string, password: string): void {
  passwords.set(key, password)
}

export function getPassword(key: string): string | undefined {
  return passwords.get(key)
}

export function hasPassword(key: string): boolean {
  return passwords.has(key)
}

/** 비밀번호가 틀렸을 때 지운다 — 안 지우면 틀린 값으로 계속 재시도한다 */
export function forgetPassword(key: string): void {
  passwords.delete(key)
}

export function forgetAllPasswords(): void {
  passwords.clear()
  // "처음부터 다시" 라는 뜻이므로 기다리던 대상도 지운다
  pending = null
}

/** 어떤 접속이 등록돼 있는지 (값은 절대 돌려주지 않는다) */
export function registeredConnections(): string[] {
  return [...passwords.keys()]
}
