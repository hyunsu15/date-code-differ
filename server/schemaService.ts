import { snapshotSortKey } from '../src/lib/fileTypes.ts'
import { diagnoseMalformed, parseSchema } from '../src/lib/schemaParse.ts'
import { compareSchemas } from '../src/lib/schemaDiff.ts'
import type { SnapshotSource } from './source/types.ts'
import {
  DEFAULT_SCHEMA_CONFIG,
  type SchemaComparisonResponse,
  type SchemaConfig,
  type SchemaExcludeInfo,
  type SchemaSnapshot,
  type SchemaSnapshotRef,
} from '../src/types.ts'

/**
 * 데이터 스키마 덤프를 읽어 좌우로 견준다.
 *
 * 소스 비교와 두 가지가 다르다.
 *
 * 1. **위치가 `root` 와 무관하다.** 스키마는 소스와 다른 자리에 쌓이므로 프리셋의
 *    `schemaRoot` 를 따로 받는다. 환경 폴더는 그 아래에 붙는다.
 * 2. **날짜가 폴더가 아니라 파일 이름에 있다.** `snapshot_prod_2026-09-01.txt` 처럼
 *    이름 규칙(`SCHEMA.fileName`)에서 날짜를 뽑아 목록을 만든다.
 *
 * 덕분에 SSH 왕복이 아주 적다 — 목록은 환경 폴더당 `ls` 한 번, 비교는 좌우 `cat`
 * 한 번씩이다. 소스 비교처럼 파일 수에 따라 늘지 않는다.
 */

/** `change/config.ts` 의 `SCHEMA` 를 실제 설정으로 바꾼다 */
export function readSchemaConfig(raw: Partial<SchemaConfig> | undefined): SchemaConfig {
  const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback

  return {
    fileName: text(raw?.fileName, DEFAULT_SCHEMA_CONFIG.fileName),
    separator: text(raw?.separator, DEFAULT_SCHEMA_CONFIG.separator),
    // 빈 문자열은 "아무것도 접지 말라" 는 뜻이라 기본값으로 되돌리지 않는다
    systemNamePattern:
      typeof raw?.systemNamePattern === 'string'
        ? raw.systemNamePattern
        : DEFAULT_SCHEMA_CONFIG.systemNamePattern,
  }
}

/** 한 쪽(좌 또는 우)이 볼 스키마 */
export interface SchemaSideRef {
  source: SnapshotSource
  /** 캐시 키에 쓰는 소스 식별자 */
  key: string
  /** 스키마 덤프가 쌓이는 폴더 (프리셋의 `schemaRoot`) */
  root: string
  /** 환경 폴더명 (`prod`). 환경을 안 쓰면 빈 문자열 */
  env: string
  /** 파일 이름에서 뽑은 날짜 */
  date: string
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 이름 규칙에 환경·날짜를 끼워 실제 파일 이름을 만든다 */
export function schemaFileName(pattern: string, env: string, date: string): string {
  return pattern.split('{env}').join(env).split('{date}').join(date)
}

/**
 * 파일 이름에서 날짜를 뽑는다. 규칙에 안 맞으면 null (그 파일은 목록에서 뺀다).
 *
 * `{env}` 를 먼저 실제 값으로 채운 뒤 `{date}` 만 잡아낸다 — 환경 폴더 안에는
 * 그 환경의 파일만 있는 것이 보통이지만, 다른 환경 파일이 섞여 있어도 걸러진다.
 */
export function schemaDateFrom(pattern: string, env: string, fileName: string): string | null {
  const withEnv = pattern.split('{env}').join(env)
  const parts = withEnv.split('{date}')
  // 규칙에 {date} 가 없으면 날짜를 가릴 수 없다 — 파일 이름을 그대로 식별자로 쓴다
  if (parts.length < 2) return withEnv === fileName ? fileName : null

  const matched = new RegExp(`^${parts.map(escapeRegExp).join('(.+)')}$`, 'i').exec(fileName)
  return matched?.[1] ?? null
}

/** `<root>/<env>/<파일>` — 환경을 안 쓰면 가운데 단이 빠진다 */
const joinPath = (...parts: string[]): string =>
  parts
    .filter((p) => p.trim())
    .map((p) => p.replace(/[\\/]+$/, ''))
    .join('/')

/**
 * 읽어 둔 스키마 캐시.
 *
 * 비교 요청마다 원격에 물어보면 SSH 왕복이 는다. 대신 파일을 고쳐도 바로 반영되지는
 * 않는다 — 화면의 새로고침(`?refresh=1`)이 이 캐시를 비운다 (`excludeRules.ts` 와 같은 규칙).
 */
const cache = new Map<string, SchemaSnapshot>()

export function clearSchemaCache(): void {
  cache.clear()
}

/**
 * 한 환경의 스키마 날짜 목록. 최신순으로 앞에 온다.
 *
 * 폴더가 없으면 **빈 목록**이다 (`listFileNames` 가 오류를 던지지 않는다) —
 * 스키마를 아직 안 올린 환경이 있는 것이 정상이라, 그것 때문에 화면이 죽으면 안 된다.
 */
export async function listSchemaSnapshots(
  source: SnapshotSource,
  root: string,
  env: string,
  cfg: SchemaConfig
): Promise<SchemaSnapshotRef[]> {
  if (!root.trim()) return []

  const names = await source.listFileNames(joinPath(root, env))

  const items: SchemaSnapshotRef[] = []
  for (const name of names) {
    const date = schemaDateFrom(cfg.fileName, env, name)
    if (date) items.push({ id: date, sortKey: snapshotSortKey(date) })
  }

  return items.sort((a, b) => {
    if (a.sortKey && b.sortKey) return b.sortKey.localeCompare(a.sortKey)
    if (a.sortKey) return -1
    if (b.sortKey) return 1
    return b.id.localeCompare(a.id)
  })
}

/** 한 쪽의 스키마 한 벌을 읽어 파싱한다. 파일이 없으면 빈 스냅샷 */
async function readSide(side: SchemaSideRef, cfg: SchemaConfig): Promise<SchemaSnapshot> {
  const file = joinPath(side.root, side.env, schemaFileName(cfg.fileName, side.env, side.date))
  const cacheKey = `${side.key} ${file} ${cfg.separator} ${cfg.systemNamePattern}`

  const cached = cache.get(cacheKey)
  if (cached) return cached

  const parsed = parseSchema(await side.source.readTextFile(file), cfg)
  cache.set(cacheKey, parsed)
  return parsed
}

/**
 * 좌우 스키마를 견준다.
 *
 * 좌우가 **같은 파일**이면 한 번만 읽는다 — 같은 환경·날짜를 양쪽에 고르는 것은
 * "이 도구가 뭘 보여주나" 를 확인할 때 자연스럽게 하는 일이라 흔하다.
 */
export async function compareSchemaSnapshots(
  left: SchemaSideRef,
  right: SchemaSideRef,
  cfg: SchemaConfig,
  exclude: SchemaExcludeInfo
): Promise<SchemaComparisonResponse> {
  const sameFile =
    left.key === right.key && left.root === right.root && left.env === right.env && left.date === right.date

  const leftSnapshot = await readSide(left, cfg)
  const rightSnapshot = sameFile ? leftSnapshot : await readSide(right, cfg)

  // 못 읽은 줄은 좌우를 합쳐 보여준다 — 어느 쪽이든 원인은 대개 하나(형식 설정)다
  const malformedSample = [
    ...leftSnapshot.malformedSample,
    ...(sameFile ? [] : rightSnapshot.malformedSample),
  ].slice(0, 3)

  return {
    left: left.date,
    right: right.date,
    // 설명이 좌우로 다르면 그것도 변경이다 — 한쪽만 보여주면 조용히 묻힌다
    leftDescription: leftSnapshot.description,
    rightDescription: rightSnapshot.description,
    tables: compareSchemas(leftSnapshot, rightSnapshot),
    malformed: leftSnapshot.malformed + (sameFile ? 0 : rightSnapshot.malformed),
    malformedSample,
    malformedHint: diagnoseMalformed(malformedSample, cfg),
    exclude,
  }
}
