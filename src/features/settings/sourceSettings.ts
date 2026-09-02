import { DEFAULT_PRESET_ID, SOURCE_PRESETS } from '../../../change/config.ts'
import {
  DEFAULT_SSH_SOURCE,
  type SourceConfig,
  type SourcePreset,
  type SshSourceConfig,
  type TextEncodingName,
} from '../../types.ts'

/**
 * 비교 대상 위치 설정.
 *
 * 값의 출처는 두 가지다.
 *  1. `change/config.ts` 의 **프리셋** — 파일이 진실이라, 고치면 화면에 바로 반영된다
 *  2. 화면에서 직접 고친 **직접 입력** — 이 브라우저의 localStorage 에만 남는다
 *
 * 어느 쪽이든 서버는 상태를 두지 않고 **요청마다** 쿼리로 받는다.
 * 비밀번호는 저장하지도, 보내지도 않는다 — SSH 인증은 ssh 에 맡긴다
 * (개인키 · ssh-agent · ~/.ssh/config).
 */

const STORAGE_KEY = 'cd-source'

export { SOURCE_PRESETS }

/** 무엇을 고른 상태인지 */
export interface SourceSelection {
  /** 고른 프리셋 id. `null` 이면 직접 입력 */
  presetId: string | null
  source: SourceConfig
}

export const presetById = (id: string | null): SourcePreset | undefined =>
  id === null ? undefined : SOURCE_PRESETS.find((p) => p.id === id)

/** 프리셋이 하나도 없을 때를 대비한 최후 기본값 */
const FALLBACK: SourceConfig = {
  mode: 'local',
  root: './sample-code',
  encoding: 'auto',
  excludeFile: '',
  schemaRoot: '',
  schemaExcludeFile: '',
}

/**
 * 저장된 선택이 없을 때 쓸 프리셋.
 * `change/config.ts` 의 `DEFAULT_PRESET_ID` 를 따르고,
 * 그 id 가 없으면 목록의 첫 항목으로 떨어진다.
 */
export function defaultSelection(): SourceSelection {
  const preset = presetById(DEFAULT_PRESET_ID) ?? SOURCE_PRESETS[0]
  return preset
    ? { presetId: preset.id, source: preset.source }
    : { presetId: null, source: FALLBACK }
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 모르는 값은 자동 판별로 둔다 */
const asEncoding = (v: unknown): TextEncodingName =>
  v === 'utf-8' || v === 'euc-kr' ? v : 'auto'

/** 저장된 JSON 을 믿지 않고 한 겹 검증한다 (사용자가 직접 고칠 수 있는 값이다) */
function parseSource(value: Record<string, unknown>): SourceConfig {
  const encoding = asEncoding(value.encoding)
  const excludeFile = asString(value.excludeFile)
  const schemaRoot = asString(value.schemaRoot)
  const schemaExcludeFile = asString(value.schemaExcludeFile)

  if (value.mode !== 'ssh') {
    return {
      mode: 'local',
      root: asString(value.root),
      encoding,
      excludeFile,
      schemaRoot,
      schemaExcludeFile,
    }
  }

  const port = Number(value.port)
  return {
    mode: 'ssh',
    host: asString(value.host),
    port: Number.isFinite(port) && port > 0 ? port : null,
    user: asString(value.user),
    identityFile: asString(value.identityFile),
    root: asString(value.root),
    encoding,
    excludeFile,
    schemaRoot,
    schemaExcludeFile,
  }
}

/**
 * 저장값을 선택 상태로 바꾼다.
 *
 * 프리셋을 고른 상태였다면 **저장된 값이 아니라 프리셋의 현재 값**을 쓴다.
 * `change/config.ts` 를 고치면 바로 반영되도록 하기 위함이다.
 */
export function parseSourceSelection(raw: string | null): SourceSelection {
  if (!raw) return defaultSelection()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultSelection()
  }
  if (typeof parsed !== 'object' || parsed === null) return defaultSelection()

  const value = parsed as Record<string, unknown>
  const presetId = typeof value.presetId === 'string' ? value.presetId : null

  const preset = presetById(presetId)
  if (preset) return { presetId: preset.id, source: preset.source }

  // 프리셋이 없어졌거나 직접 입력한 경우 — 저장된 값을 쓴다
  const source = value.source
  if (typeof source !== 'object' || source === null) return defaultSelection()
  return { presetId: null, source: parseSource(source as Record<string, unknown>) }
}

export function loadSourceSelection(): SourceSelection {
  try {
    return parseSourceSelection(localStorage.getItem(STORAGE_KEY))
  } catch {
    return defaultSelection() // 저장소 접근 자체가 막힌 브라우저
  }
}

export function saveSourceSelection(selection: SourceSelection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}

/**
 * API 쿼리 파라미터로 편다.
 * 기본값과 같은 항목은 보내지 않아 URL 을 짧게 유지한다.
 */
export function sourceParams(config: SourceConfig): Record<string, string> {
  const params: Record<string, string> = {}

  // 기본값(auto)이면 보내지 않는다 — 서버도 같은 기본값을 쓴다
  if (config.encoding !== 'auto') params.encoding = config.encoding

  // 제외 목록을 안 쓰면 보내지 않는다 — 쓰지 않는 배치에서 URL 이 예전과 똑같이 유지된다
  const excludeFile = (config.excludeFile ?? '').trim()
  if (excludeFile) params.excludeFile = excludeFile

  // 스키마 위치도 마찬가지 — 안 쓰면 안 보낸다
  const schemaRoot = (config.schemaRoot ?? '').trim()
  if (schemaRoot) params.schemaRoot = schemaRoot

  const schemaExcludeFile = (config.schemaExcludeFile ?? '').trim()
  if (schemaExcludeFile) params.schemaExcludeFile = schemaExcludeFile

  if (config.mode !== 'ssh') {
    params.mode = 'local'
    params.root = config.root.trim()
    return params
  }

  params.mode = 'ssh'
  params.host = config.host.trim()
  params.user = config.user.trim()
  params.root = config.root.trim()
  if (config.port) params.port = String(config.port)
  if (config.identityFile.trim()) params.identityFile = config.identityFile.trim()
  return params
}

/**
 * 비교 요청용 파라미터 — 좌우가 서로 다른 폴더를 볼 수 있게 **위치만** 갈라 보낸다.
 *
 * 서버·계정·인코딩은 좌우가 같다 (환경은 루트 아래 하위 폴더라는 전제다).
 * 그래서 갈리는 값은 `root` 하나뿐이고, **다를 때만** `rightRoot` 를 덧붙인다 —
 * 같은 위치를 볼 때는 URL 이 예전과 똑같이 유지된다.
 */
export function comparisonParams(
  left: SourceConfig,
  right: SourceConfig
): Record<string, string> {
  const params = sourceParams(left)
  const rightRoot = right.root.trim()
  if (rightRoot !== params.root) params.rightRoot = rightRoot
  return params
}

/** 화면에 보여줄 한 줄 요약 */
export function describeSource(config: SourceConfig): string {
  if (config.mode !== 'ssh') return config.root.trim() || '(폴더 미지정)'
  const { user, host, port, root } = config
  if (!host.trim()) return 'SSH (설정 필요)'
  return `${user || '?'}@${host}${port ? `:${port}` : ''} ${root}`
}

/** 바로 쓸 수 있는 설정인지 — 아니면 무엇이 비었는지 알려준다 */
export function missingFields(config: SourceConfig): string[] {
  if (config.mode !== 'ssh') return config.root.trim() ? [] : ['폴더 경로']

  const labels: Record<string, string> = { host: '호스트', user: '계정', root: '원격 경로' }
  return (['host', 'user', 'root'] as const)
    .filter((k) => !config[k].trim())
    .map((k) => labels[k])
}

export { DEFAULT_SSH_SOURCE }
export type { SshSourceConfig }
