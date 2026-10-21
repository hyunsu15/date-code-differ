import * as userConfig from '../../../change/config.ts'
import type { EnvFolder, Side, SourceConfig } from '../../types.ts'

/**
 * 환경 폴더 — 운영 / 테스트.
 *
 * 환경이 루트 아래 폴더로 나뉘어 있을 때(`release/prod/20260801`) 어느 환경을 볼지 고른다.
 * 고르면 그 경로가 **루트 뒤에 붙는다** — `release` 를 고른 채 운영을 누르면 `release/prod`.
 *
 * **좌우가 각각 고른다.** 운영과 테스트는 배포 시점이 다르므로 같은 날짜 폴더가 양쪽에
 * 다 있으리라는 보장이 없다 — 한쪽만 고르게 하면 "지금 운영과 테스트가 얼마나 벌어져
 * 있나" 라는, 정작 제일 자주 묻는 질문에 답을 못 한다.
 *
 * 거르는 게 아니라 **위치를 바꾸는** 일이다. 그래서 서버에 따로 보낼 값이 없다:
 * 붙인 결과가 그냥 그 요청의 루트가 되고, 날짜 목록·비교·파일 본문이 모두 같은 곳을 본다.
 *
 * 목록은 `change/config.ts` 의 `ENV_FOLDERS` 에서 오고 — 파일이 진실이라 고치면 바로 반영된다 —
 * 고른 값은 이 브라우저의 localStorage 에만 남는다.
 */

const STORAGE_KEY = 'cd-env'
const LINK_STORAGE_KEY = 'cd-env-linked'

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

/** 좌우가 각각 보고 있는 환경 */
export interface EnvPair {
  left: string
  right: string
}

/**
 * 저장된 선택이 없을 때 좌우가 볼 환경 — **양쪽을 다르게 연다.**
 *
 * 이 도구를 여는 이유가 대개 "지금 운영과 테스트가 얼마나 벌어져 있나" 라서다.
 * 한 환경의 두 날짜를 견주는 것도 흔하지만 그건 날짜 칸만 바꾸면 되는 반면,
 * 환경을 갈라 보려면 양쪽을 다 바꿔야 해서 손이 더 간다.
 *
 * 왼쪽은 `change/config.ts` 의 `DEFAULT_ENV_ID`, 오른쪽은 목록에서 그 다음 환경이다.
 * 환경이 하나뿐이면 양쪽 다 그것 — 그때는 예전처럼 한 환경의 두 날짜 비교가 된다.
 */
export function defaultEnvPair(): EnvPair {
  const left = defaultEnvId()
  return { left, right: ENV_FOLDERS.find((e) => e.id !== left)?.id ?? left }
}

/**
 * 저장값을 좌우 선택으로 바꾼다.
 *
 * 예전에는 환경 하나만 저장했다(`"prod"`). 그 값이 남아 있으면 **양쪽 다 그 환경**으로
 * 읽는다 — 기존 사용자가 열었을 때 화면이 예전과 똑같이 보이는 게 맞다.
 */
export function parseEnvPair(raw: string | null): EnvPair {
  const fallback = defaultEnvPair()
  if (!raw) return fallback

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 예전 저장값 — 환경 id 문자열 하나. **아는 id 일 때만** 그 뜻으로 읽는다.
    // 아무 문자열이나 첫 항목으로 떨어뜨리면, 망가진 값이 "양쪽 다 운영" 이라는
    // 멀쩡해 보이는 선택으로 둔갑한다.
    const legacy = ENV_FOLDERS.find((e) => e.id === raw)
    return legacy ? { left: legacy.id, right: legacy.id } : fallback
  }

  if (typeof parsed !== 'object' || parsed === null) return fallback

  const value = parsed as Record<string, unknown>
  return {
    left: typeof value.left === 'string' ? envById(value.left).id : fallback.left,
    right: typeof value.right === 'string' ? envById(value.right).id : fallback.right,
  }
}

export function loadEnvPair(): EnvPair {
  try {
    return parseEnvPair(localStorage.getItem(STORAGE_KEY))
  } catch {
    return defaultEnvPair() // 저장소 접근 자체가 막힌 브라우저
  }
}

export function saveEnvPair(pair: EnvPair): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pair))
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}

/**
 * 한쪽 환경을 바꾼 결과.
 *
 * **묶여 있으면 양쪽이 함께 간다.** 운영의 두 날짜를 보다가 테스트의 두 날짜로 넘어가는 일이
 * 잦은데, 좌우가 따로면 매번 두 번 골라야 하고 그 사이 한 번은 엉뚱한 운영↔테스트 비교가 뜬다.
 */
export function pickEnv(pair: EnvPair, side: Side, id: string, linked: boolean): EnvPair {
  if (linked) return { left: id, right: id }
  return side === 'left' ? { ...pair, left: id } : { ...pair, right: id }
}

/**
 * 묶기를 켤 때의 좌우 — 오른쪽을 왼쪽에 맞춘다.
 * 묶인 채로 양쪽이 다르면 "묶였다" 는 표시와 화면이 어긋난다. 왼쪽이 기준이라 왼쪽을 따른다.
 */
export const linkEnvPair = (pair: EnvPair): EnvPair => pickEnv(pair, 'left', pair.left, true)

/** 저장값을 묶기 여부로 바꾼다. 명시적으로 켠 적이 있을 때만 켠다 */
export const parseEnvLinked = (raw: string | null): boolean => raw === '1'

export function loadEnvLinked(): boolean {
  try {
    return parseEnvLinked(localStorage.getItem(LINK_STORAGE_KEY))
  } catch {
    return false
  }
}

export function saveEnvLinked(linked: boolean): void {
  try {
    localStorage.setItem(LINK_STORAGE_KEY, linked ? '1' : '0')
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}

/** 루트 뒤에 붙일 하위 경로. 설정에 환경이 없으면 빈 문자열 */
export const envPath = (id: string): string => envById(id).path.trim()

/** 준비해 둔 환경 색 가짓수 (`styles.css` 의 `.env-c*`). 이보다 많으면 앞에서부터 다시 쓴다 */
const ENV_COLORS = 4

/**
 * 환경별 색 클래스.
 *
 * 운영과 테스트를 나란히 놓으면 이름만으로는 잘 안 걸린다. 색이 붙어야 눈에 먼저 들어온다.
 * 어느 색인지는 **`ENV_FOLDERS` 의 순서**로 정한다 — 환경 이름(`prod` · `stage` · `운영`)은
 * 프로젝트마다 달라서 이름으로 색을 박아 둘 수가 없다. 순서를 바꾸면 색도 따라간다.
 *
 * 설정에 없는 id 면 빈 문자열 — 그때는 태그가 예전처럼 좌/우 색(빨강·초록)을 쓴다.
 */
export function envColorClass(id: string): string {
  const index = ENV_FOLDERS.findIndex((e) => e.id === id)
  return index < 0 ? '' : `env-c${index % ENV_COLORS}`
}

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
