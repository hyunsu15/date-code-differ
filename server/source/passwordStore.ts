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

const passwords = new Map<string, string>()

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
}

/** 어떤 접속이 등록돼 있는지 (값은 절대 돌려주지 않는다) */
export function registeredConnections(): string[] {
  return [...passwords.keys()]
}
