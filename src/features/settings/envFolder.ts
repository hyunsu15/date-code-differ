import * as userConfig from '../../../change/config.ts'
import type { EnvFolder, SourceConfig } from '../../types.ts'

/**
 * 환경 폴더 — 운영 / 테스트 / 개발.
 *
 * 환경이 루트 아래 폴더로 나뉘어 있을 때(`release/prod/20260801`) 어느 환경을 볼지 고른다.
 * 고르면 그 경로가 **루트 뒤에 붙는다** — `release` 를 고른 채 운영을 누르면 `release/prod`.
 *
 * 거르는 게 아니라 **위치를 바꾸는** 일이다. 그래서 서버에 따로 보낼 값이 없다:
 * 붙인 결과가 그냥 그 요청의 루트가 되고, 날짜 목록·비교·파일 본문이 모두 같은 곳을 본다.
 *
 * 목록은 `change/config.ts` 의 `ENV_FOLDERS` 에서 오고 — 파일이 진실이라 고치면 바로 반영된다 —
 * 고른 값은 이 브라우저의 localStorage 에만 남는다.
 */

const STORAGE_KEY = 'cd-env'

/**
 * 환경 설정은 나중에 생겼다 — 예전에 만들어 둔 `change/config.ts` 에는 없을 수 있다.
 * 없으면 환경 고르기를 통째로 숨긴다 (설정 하나 때문에 화면이 죽는 것보다 낫다).
 */
const configured = userConfig as {
  ENV_FOLDERS?: EnvFolder[]
  DEFAULT_ENV_ID?: string
}

/** 설정에 적힌 환경들. 경로가 빈 항목은 버린다 */
export const ENV_FOLDERS: EnvFolder[] = (
  Array.isArray(configured.ENV_FOLDERS) ? configured.ENV_FOLDERS : []
).filter((e) => e?.id && e.path?.trim())

/**
 * 화면에 그릴 목록 = 설정에 적힌 그대로다.
 *
 * **"루트를 그대로" 라는 선택지는 두지 않는다.** 환경 폴더를 쓰는 배치에서 루트를 읽으면
 * 날짜가 아니라 `prod` `test` `dev` 가 목록에 올라와 이전/이후 칸을 채워 버린다.
 * 루트를 보고 싶은 배치(날짜가 루트에 바로 있는 경우)는 `ENV_FOLDERS` 를 비우면 된다 —
 * 그러면 고르는 자리 자체가 사라지고 루트를 그대로 읽는다.
 */
export const ENV_CHOICES: EnvFolder[] = ENV_FOLDERS

/** 설정에 환경이 없을 때 — 고르는 자리도 없고, 루트를 그대로 읽는다 */
const NO_ENV: EnvFolder = { id: '', label: '', path: '' }

/** 모르는 id 는 첫 항목으로 떨어진다 (설정에서 그 항목을 지웠거나 이름을 바꾼 경우) */
export const envById = (id: string): EnvFolder =>
  ENV_FOLDERS.find((e) => e.id === id) ?? ENV_FOLDERS[0] ?? NO_ENV

/** 저장된 선택이 없을 때 쓸 환경 — `change/config.ts` 의 `DEFAULT_ENV_ID` 를 따른다 */
export function defaultEnvId(): string {
  return envById(configured.DEFAULT_ENV_ID ?? '').id
}

/** 저장값을 선택 상태로 바꾼다 */
export function parseEnvId(raw: string | null): string {
  return raw ? envById(raw).id : defaultEnvId()
}

export function loadEnvId(): string {
  try {
    return parseEnvId(localStorage.getItem(STORAGE_KEY))
  } catch {
    return defaultEnvId() // 저장소 접근 자체가 막힌 브라우저
  }
}

export function saveEnvId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}

/** 루트 뒤에 붙일 하위 경로. 설정에 환경이 없으면 빈 문자열 */
export const envPath = (id: string): string => envById(id).path.trim()

/**
 * 루트와 하위 경로를 잇는다.
 *
 * 구분자는 `/` 로 낸다 — 원격(POSIX)은 이것뿐이고, 로컬은 서버가 `path.resolve` 로
 * 다시 풀기 때문에 윈도우에서도 `D:\release/prod` 가 그대로 통한다.
 * 홈 기준 경로(`~/release`)는 앞을 건드리지 않아야 원격 셸이 확장할 수 있다.
 */
export function joinRoot(root: string, sub: string): string {
  const tail = sub.trim().replace(/^[/\\]+|[/\\]+$/g, '')
  const base = root.trim().replace(/[/\\]+$/, '')
  if (!tail) return base
  if (!base) return tail
  return `${base}/${tail}`
}

/**
 * 고른 환경까지 내려간 위치.
 *
 * 루트를 고른 상태면 **받은 것을 그대로** 돌려준다 — 화면이 이 값의 동일성으로
 * "목록이 이 위치의 것인지" 를 가리므로 새 객체를 만들면 안 된다.
 */
export function withEnv(source: SourceConfig, path: string): SourceConfig {
  if (!path.trim()) return source
  return { ...source, root: joinRoot(source.root, path) }
}
