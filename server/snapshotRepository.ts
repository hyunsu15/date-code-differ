import {
  hasComparableExt,
  packageOf,
  parseExtensions,
  snapshotSortKey,
} from '../src/lib/fileTypes.ts'
import type { SnapshotSource } from './source/types.ts'
import type { ScanConfig, Snapshot } from '../src/types.ts'

/**
 * 소스(로컬 폴더 / SSH 원격) 위에서 스냅샷과 파일 목록을 만든다.
 * 여기서는 **어디서 읽는지 모른다** — 확장자·용량 필터와 정렬만 담당한다.
 */

export interface RepositoryConfig {
  extensions: ReadonlySet<string>
  maxFileBytes: number
}

const DEFAULT_MAX_FILE_BYTES = 2_000_000

/** `change/config.ts` 의 `SCAN` 을 실제 훑기 설정으로 바꾼다 */
export function readRepositoryConfig(scan: Partial<ScanConfig> = {}): RepositoryConfig {
  const max = Number(scan.maxFileBytes)
  return {
    extensions: parseExtensions(scan.extensions?.join(',')),
    maxFileBytes: Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_FILE_BYTES,
  }
}

export interface SnapshotFile {
  /** 날짜 폴더 기준 상대 경로 */
  path: string
  name: string
  packageName: string
  size: number
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
 * 폴더명이 접두사로 시작하는지 — 대소문자는 구분하지 않는다.
 * 접두사가 비어 있으면(= 전체 보기) 전부 통과시킨다.
 */
export function matchesPrefix(name: string, prefix: string): boolean {
  const want = prefix.trim().toLowerCase()
  return want === '' || name.toLowerCase().startsWith(want)
}

/**
 * 날짜 스냅샷 목록.
 * 날짜로 읽히는 폴더가 최신순으로 앞에, 나머지는 이름 역순으로 뒤에 온다.
 *
 * @param prefix 폴더 이름 접두사(`prod` 등). 비우면 거르지 않는다
 */
export async function listSnapshots(
  source: SnapshotSource,
  cfg: RepositoryConfig,
  key: string,
  prefix = ''
): Promise<Snapshot[]> {
  // 훑기 전에 거른다 — 스냅샷마다 파일을 세는 게 비싼 쪽이다 (SSH 면 폴더당 find 한 번)
  const names = (await source.listSnapshotDirs()).filter((n) => matchesPrefix(n, prefix))

  const items: Snapshot[] = []
  for (const name of names) {
    const { files } = await scanSnapshot(source, cfg, key, name)
    items.push({
      id: name,
      sortKey: snapshotSortKey(name),
      fileCount: files.length,
      packageCount: new Set(files.map((f) => f.packageName)).size,
    })
  }

  return items.sort((a, b) => {
    if (a.sortKey && b.sortKey) return b.sortKey.localeCompare(a.sortKey)
    if (a.sortKey) return -1
    if (b.sortKey) return 1
    return b.id.localeCompare(a.id)
  })
}

/** 한 스냅샷 안의 비교 대상 파일을 상대 경로순으로 돌려준다 */
export async function scanSnapshot(
  source: SnapshotSource,
  cfg: RepositoryConfig,
  key: string,
  snapshotId: string
): Promise<SnapshotScan> {
  const cacheKey = `${key} ${snapshotId}`
  const cached = scanCache.get(cacheKey)
  if (cached) return cached

  const scan: SnapshotScan = { files: [], skipped: 0 }

  for (const raw of await source.listFiles(snapshotId)) {
    if (!hasComparableExt(raw.path, cfg.extensions) || raw.size > cfg.maxFileBytes) {
      scan.skipped++
      continue
    }
    scan.files.push({
      path: raw.path,
      name: raw.path.split('/').pop() ?? raw.path,
      packageName: packageOf(raw.path),
      size: raw.size,
    })
  }

  scan.files.sort((a, b) => a.path.localeCompare(b.path))
  scanCache.set(cacheKey, scan)
  return scan
}

/** 파일 본문. 없거나 읽을 수 없으면 null */
export function readFileText(
  source: SnapshotSource,
  snapshotId: string,
  relPath: string
): Promise<string | null> {
  return source.readFile(snapshotId, relPath)
}
