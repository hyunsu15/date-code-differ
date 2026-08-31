import { buildFileDiff } from '../src/lib/diffEngine.ts'
import { DEFAULT_OPTIONS } from '../src/lib/normalize.ts'
import {
  readFileTexts,
  scanSnapshots,
  type RepositoryConfig,
  type SnapshotFile,
  type SnapshotScan,
} from './snapshotRepository.ts'
import type { SnapshotSource } from './source/types.ts'
import type {
  ComparedFile,
  ComparisonResponse,
  DiffOptions,
  FileContentResponse,
  FileStatus,
  PackageChange,
  PackageStatus,
} from '../src/types.ts'

/**
 * 두 스냅샷을 비교해 "무엇이 바뀌었는지"만 만들어낸다.
 * 파일 본문은 응답에 넣지 않는다 — 선택한 파일만 별도로 읽어간다.
 */

/** 비교 결과 캐시 — (소스, 좌, 우, 무시옵션) 이 같으면 다시 계산하지 않는다 */
const comparisonCache = new Map<string, ComparisonResponse>()

export function clearComparisonCache(): void {
  comparisonCache.clear()
}

function cacheKey(sourceKey: string, left: string, right: string, opts: DiffOptions): string {
  const flags = [
    opts.ignoreWhitespace,
    opts.ignoreCase,
    opts.ignoreBlankLines,
    opts.ignoreComments,
  ]
    .map((b) => (b ? '1' : '0'))
    .join('')
  return `${sourceKey} ${left} ${right} ${flags}`
}

export async function compareSnapshots(
  source: SnapshotSource,
  cfg: RepositoryConfig,
  sourceKey: string,
  leftId: string,
  rightId: string,
  options: DiffOptions = DEFAULT_OPTIONS
): Promise<ComparisonResponse> {
  const key = cacheKey(sourceKey, leftId, rightId, options)
  const cached = comparisonCache.get(key)
  if (cached) return cached

  const scans = await scanSnapshots(source, cfg, sourceKey, [leftId, rightId])
  const empty: SnapshotScan = { files: [], skipped: 0 }
  const leftScan = scans.get(leftId) ?? empty
  const rightScan = scans.get(rightId) ?? empty

  const leftByPath = new Map(leftScan.files.map((f) => [f.path, f]))
  const rightByPath = new Map(rightScan.files.map((f) => [f.path, f]))
  const allPaths = [...new Set([...leftByPath.keys(), ...rightByPath.keys()])].sort((a, b) =>
    a.localeCompare(b)
  )

  const files: ComparedFile[] = []
  for (const batch of chunk(allPaths, COMPARE_BATCH)) {
    const leftWanted: string[] = []
    const rightWanted: string[] = []
    /** 좌측 본문을 우측 본문으로도 그대로 쓰는 파일 (내용이 같다고 판명된 것) */
    const mirrored = new Set<string>()

    for (const relPath of batch) {
      const left = leftByPath.get(relPath)
      const right = rightByPath.get(relPath)

      if (left) leftWanted.push(relPath)
      if (!right) continue
      // 내용이 같으면 한쪽만 받아 양쪽에 쓴다 — 전송량이 절반이 된다.
      // 통계(총 줄 수·문자 수)는 동일한 파일에서도 요약 카드에 들어가므로
      // 읽기를 아예 건너뛸 수는 없다. 두 번 받지 않는 것까지가 여기서 할 수 있는 일이다.
      if (left && sameContent(left, right)) mirrored.add(relPath)
      else rightWanted.push(relPath)
    }

    // 본문을 **한 번에 몰아서** 받는다. 파일마다 따로 물어보면 SSH 왕복이 파일 수에 비례한다.
    const [leftTexts, rightTexts] = await Promise.all([
      readFileTexts(source, leftId, leftWanted),
      readFileTexts(source, rightId, rightWanted),
    ])

    for (const relPath of batch) {
      const leftText = leftTexts.get(relPath) ?? null
      files.push(
        compareOne(
          relPath,
          leftByPath.get(relPath),
          rightByPath.get(relPath),
          leftText,
          mirrored.has(relPath) ? leftText : (rightTexts.get(relPath) ?? null),
          options
        )
      )
    }
    // 본문은 여기서 버린다 — 통계만 남기므로 스냅샷 전체를 메모리에 쌓지 않는다
  }

  const response: ComparisonResponse = {
    left: leftId,
    right: rightId,
    packages: buildPackageChanges(files, leftScan.files, rightScan.files),
    files,
    skipped: leftScan.skipped + rightScan.skipped,
  }
  comparisonCache.set(key, response)
  return response
}

/**
 * 좌우 파일이 **내용까지 같은지** 를 본문 없이 판정한다.
 *
 * `checksum` 은 소스가 목록을 만들면서 덤으로 낼 수 있을 때만 채워진다 (SSH 는 `cksum`,
 * 로컬은 null). 없으면 판정하지 않는다 — 못 미더워서 건너뛰는 게 아니라, 왕복 비용이
 * 없는 소스에서는 체크섬을 만드느라 파일을 한 번 더 읽는 것이 순수한 손해라서다.
 *
 * 값 자체에 크기가 들어 있어(`<CRC>:<크기>`) 이 비교 하나로 크기까지 함께 본다.
 */
const sameContent = (left: SnapshotFile, right: SnapshotFile): boolean =>
  left.checksum !== null && left.checksum === right.checksum

/**
 * 한 번에 본문을 올려 두는 파일 수.
 * 왕복은 줄이되 스냅샷 전체가 메모리에 쌓이지 않도록 여기서 끊는다
 * (파일 하나가 `maxFileBytes` 까지 갈 수 있다).
 */
const COMPARE_BATCH = 200

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * 한 파일의 좌우를 견준다. **읽기는 이미 끝난 상태**로 들어온다 —
 * 여기서 소스를 건드리면 왕복이 파일 수만큼 늘어난다.
 */
function compareOne(
  relPath: string,
  left: SnapshotFile | undefined,
  right: SnapshotFile | undefined,
  leftText: string | null,
  rightText: string | null,
  options: DiffOptions
): ComparedFile {
  const meta = (right ?? left) as SnapshotFile
  const base = {
    path: relPath,
    name: meta.name,
    packageName: meta.packageName,
    leftSize: left?.size ?? null,
    rightSize: right?.size ?? null,
  }

  // 한쪽에만 있는 파일도 빈 파일과 비교해 통계를 채운다.
  // 그래야 전체 합계와 패키지 요약이 실제 변경 줄 수를 반영한다.
  // 읽기 실패는 "내용 없음"으로 취급해 목록에서 사라지지 않게 한다
  const { stats } = buildFileDiff(leftText ?? '', rightText ?? '', options)

  const status: FileStatus = !left
    ? 'added'
    : !right
      ? 'removed'
      : stats.changedLines === 0
        ? 'same'
        : 'modified'

  return { ...base, status, stats }
}

/**
 * 패키지(= 날짜 폴더 바로 아래 디렉터리) 단위 요약.
 * 한쪽에만 존재하는 패키지는 파일 상태와 무관하게 신규/삭제로 본다.
 */
function buildPackageChanges(
  files: readonly ComparedFile[],
  leftFiles: readonly SnapshotFile[],
  rightFiles: readonly SnapshotFile[]
): PackageChange[] {
  const leftPackages = new Set(leftFiles.map((f) => f.packageName))
  const rightPackages = new Set(rightFiles.map((f) => f.packageName))

  const byName = new Map<string, PackageChange>()
  const ensure = (name: string): PackageChange => {
    const found = byName.get(name)
    if (found) return found
    const created: PackageChange = {
      name,
      status: 'same',
      added: 0,
      removed: 0,
      modified: 0,
      same: 0,
      changedLines: 0,
    }
    byName.set(name, created)
    return created
  }

  for (const file of files) {
    const pkg = ensure(file.packageName)
    pkg[file.status]++
    pkg.changedLines += file.stats.changedLines
  }

  for (const pkg of byName.values()) {
    pkg.status = packageStatus(pkg, leftPackages.has(pkg.name), rightPackages.has(pkg.name))
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function packageStatus(pkg: PackageChange, inLeft: boolean, inRight: boolean): PackageStatus {
  if (!inLeft) return 'added'
  if (!inRight) return 'removed'
  if (pkg.added + pkg.removed + pkg.modified > 0) return 'modified'
  return 'same'
}

/** 선택한 파일 한 건의 좌우 본문 */
export async function readFilePair(
  source: SnapshotSource,
  leftId: string,
  rightId: string,
  relPath: string
): Promise<FileContentResponse> {
  const [leftTexts, rightTexts] = await Promise.all([
    readFileTexts(source, leftId, [relPath]),
    readFileTexts(source, rightId, [relPath]),
  ])
  return {
    path: relPath,
    leftText: leftTexts.get(relPath) ?? null,
    rightText: rightTexts.get(relPath) ?? null,
  }
}
