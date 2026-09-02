import { DEFAULT_EXCLUDE_SEPARATORS } from '../src/lib/excludeList.ts'
import {
  hasComparableExt,
  packageOf,
  parseExtensions,
  snapshotSortKey,
} from '../src/lib/fileTypes.ts'
import type { RawFile, SnapshotSource } from './source/types.ts'
import { readSchemaConfig } from './schemaService.ts'
import type { SchemaConfig, ScanConfig, Snapshot } from '../src/types.ts'

/**
 * 소스(로컬 폴더 / SSH 원격) 위에서 스냅샷과 파일 목록을 만든다.
 * 여기서는 **어디서 읽는지 모른다** — 확장자·용량 필터와 정렬만 담당한다.
 */

export interface RepositoryConfig {
  extensions: ReadonlySet<string>
  maxFileBytes: number
  /** 제외 목록 파일에서 항목을 가르는 글자들 (`src/lib/excludeList.ts` 가 쓴다) */
  excludeSeparators: readonly string[]
  /** 데이터 스키마 덤프의 이름 규칙·줄 형식 (`server/schemaService.ts` 가 쓴다) */
  schema: SchemaConfig
}

const DEFAULT_MAX_FILE_BYTES = 2_000_000

/** `change/config.ts` 의 `SCAN` 을 실제 훑기 설정으로 바꾼다 */
export function readRepositoryConfig(
  scan: Partial<ScanConfig> = {},
  schema?: Partial<SchemaConfig>
): RepositoryConfig {
  const max = Number(scan.maxFileBytes)
  const separators = scan.excludeSeparators?.filter((s) => typeof s === 'string' && s.length > 0)
  return {
    extensions: parseExtensions(scan.extensions?.join(',')),
    maxFileBytes: Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_FILE_BYTES,
    // 나중에 생긴 설정이라 없을 수 있다 — 그때는 쉼표와 줄바꿈 둘 다 받는다
    excludeSeparators:
      separators && separators.length > 0 ? separators : DEFAULT_EXCLUDE_SEPARATORS,
    // 스키마 설정도 나중에 생겼다 — 없으면 기본 규칙으로 읽는다
    schema: readSchemaConfig(schema),
  }
}

export interface SnapshotFile {
  /** 날짜 폴더 기준 상대 경로 */
  path: string
  name: string
  packageName: string
  size: number
  /** 본문을 읽지 않고 좌우가 같은지 가리기 위한 값. 소스가 못 내면 null */
  checksum: string | null
}

export interface SnapshotScan {
  files: SnapshotFile[]
  /** 확장자 미대상·용량 초과로 제외된 파일 수 */
  skipped: number
}

/**
 * 스냅샷별 훑기 결과 캐시.
 * 소스가 다르면 같은 날짜 이름이라도 다른 내용이므로 키에 소스를 함께 넣는다.
 */
const scanCache = new Map<string, SnapshotScan>()

export function clearCache(): void {
  scanCache.clear()
}

/**
 * 날짜 스냅샷 목록.
 * 날짜로 읽히는 폴더가 최신순으로 앞에, 나머지는 이름 역순으로 뒤에 온다.
 *
 * 환경(운영/테스트/개발)은 여기서 거르지 않는다 — 화면이 고른 환경 폴더를 루트에 붙여
 * 보내므로, 이 함수가 보는 루트가 이미 그 환경이다.
 */
export async function listSnapshots(
  source: SnapshotSource,
  cfg: RepositoryConfig,
  key: string
): Promise<Snapshot[]> {
  const names = await source.listSnapshotDirs()
  // 폴더마다 하나씩 물어보면 SSH 에서 왕복이 폴더 수만큼 늘어난다. 한 번에 받는다.
  const scans = await scanSnapshots(source, cfg, key, names)

  const items: Snapshot[] = names.map((name) => {
    const files = scans.get(name)?.files ?? []
    return {
      id: name,
      sortKey: snapshotSortKey(name),
      fileCount: files.length,
      packageCount: new Set(files.map((f) => f.packageName)).size,
    }
  })

  return items.sort((a, b) => {
    if (a.sortKey && b.sortKey) return b.sortKey.localeCompare(a.sortKey)
    if (a.sortKey) return -1
    if (b.sortKey) return 1
    return b.id.localeCompare(a.id)
  })
}

/**
 * 여러 스냅샷의 비교 대상 파일을 한 번에 훑는다.
 * **캐시에 없는 것만** 소스에 물어보므로, 두 번째부터는 왕복이 아예 없다.
 */
export async function scanSnapshots(
  source: SnapshotSource,
  cfg: RepositoryConfig,
  key: string,
  snapshotIds: readonly string[]
): Promise<Map<string, SnapshotScan>> {
  const out = new Map<string, SnapshotScan>()
  const missing: string[] = []

  for (const id of new Set(snapshotIds)) {
    const cached = scanCache.get(`${key} ${id}`)
    if (cached) out.set(id, cached)
    else missing.push(id)
  }

  if (missing.length > 0) {
    const listed = await source.listFilesIn(missing)
    // 소스가 돌려주지 않은 스냅샷도 캐시에 빈 결과로 남긴다 —
    // 없는 폴더를 물어볼 때마다 다시 접속하지 않기 위해서다
    for (const id of missing) {
      const scan = toScan(listed.get(id) ?? [], cfg)
      scanCache.set(`${key} ${id}`, scan)
      out.set(id, scan)
    }
  }

  return out
}

/** 한 스냅샷 안의 비교 대상 파일을 상대 경로순으로 돌려준다 */
export async function scanSnapshot(
  source: SnapshotSource,
  cfg: RepositoryConfig,
  key: string,
  snapshotId: string
): Promise<SnapshotScan> {
  const scans = await scanSnapshots(source, cfg, key, [snapshotId])
  return scans.get(snapshotId) ?? { files: [], skipped: 0 }
}

/** 확장자·용량 필터를 적용하고 상대 경로순으로 정렬한다 */
function toScan(raws: readonly RawFile[], cfg: RepositoryConfig): SnapshotScan {
  const scan: SnapshotScan = { files: [], skipped: 0 }

  for (const raw of raws) {
    if (!hasComparableExt(raw.path, cfg.extensions) || raw.size > cfg.maxFileBytes) {
      scan.skipped++
      continue
    }
    scan.files.push({
      path: raw.path,
      name: raw.path.split('/').pop() ?? raw.path,
      packageName: packageOf(raw.path),
      size: raw.size,
      checksum: raw.checksum,
    })
  }

  scan.files.sort((a, b) => a.path.localeCompare(b.path))
  return scan
}

/**
 * 여러 파일의 본문을 한 번에. 없거나 읽을 수 없는 파일은 결과에서 빠진다.
 * 빈 파일(`''`)과 없는 파일이 구분된다.
 */
export function readFileTexts(
  source: SnapshotSource,
  snapshotId: string,
  relPaths: readonly string[]
): Promise<Map<string, string>> {
  return source.readFiles(snapshotId, relPaths)
}
