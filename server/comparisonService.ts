import { buildFileDiff } from '../src/lib/diffEngine.ts'
import { DEFAULT_OPTIONS } from '../src/lib/normalize.ts'
import { NO_EXCLUDE, type ExcludeState } from './excludeRules.ts'
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
 *
 * **좌우는 서로 다른 위치일 수 있다.** 운영과 테스트가 루트 아래 다른 폴더로 나뉘어
 * 있으면 한쪽은 `release/prod`, 다른 쪽은 `release/test` 를 본다. 같은 위치의 두
 * 날짜를 견주는 것은 그 특수한 경우일 뿐이라, 여기서는 양쪽을 따로 받는다.
 */

/** 비교 한쪽 — 어디의 어느 스냅샷인지 */
export interface SideRef {
  source: SnapshotSource
  /** 소스 캐시 키. 좌우가 다른 위치일 수 있어 각자 들고 있다 */
  key: string
  snapshotId: string
}

/** 비교 결과 캐시 — (좌 위치·날짜, 우 위치·날짜, 무시옵션) 이 같으면 다시 계산하지 않는다 */
const comparisonCache = new Map<string, ComparisonResponse>()

export function clearComparisonCache(): void {
  comparisonCache.clear()
}

/**
 * 캐시 키.
 * 값에 공백·구분자가 들어갈 수 있어 이어 붙이지 않고 JSON 으로 만든다 —
 * 서로 다른 조합이 같은 키로 뭉개지면 엉뚱한 비교 결과가 나온다.
 */
function cacheKey(left: SideRef, right: SideRef, opts: DiffOptions): string {
  const flags = [
    opts.ignoreWhitespace,
    opts.ignoreCase,
    opts.ignoreBlankLines,
    opts.ignoreComments,
    opts.ignoreAuthor,
    opts.ignoreDeadCode,
  ]
    .map((b) => (b ? '1' : '0'))
    .join('')
  return JSON.stringify([left.key, left.snapshotId, right.key, right.snapshotId, flags])
}

const EMPTY_SCAN: SnapshotScan = { files: [], skipped: 0 }

/**
 * 좌우 스냅샷을 훑는다.
 * **위치가 같으면 한 번에** 물어본다 — 같은 폴더의 두 날짜를 견주는 흔한 경우에서
 * 왕복이 하나 준다 (SSH 는 명령 하나가 곧 접속 하나다).
 */
async function scanBothSides(
  cfg: RepositoryConfig,
  left: SideRef,
  right: SideRef
): Promise<[SnapshotScan, SnapshotScan]> {
  if (left.key === right.key) {
    const scans = await scanSnapshots(left.source, cfg, left.key, [
      left.snapshotId,
      right.snapshotId,
    ])
    return [scans.get(left.snapshotId) ?? EMPTY_SCAN, scans.get(right.snapshotId) ?? EMPTY_SCAN]
  }

  const [leftScans, rightScans] = await Promise.all([
    scanSnapshots(left.source, cfg, left.key, [left.snapshotId]),
    scanSnapshots(right.source, cfg, right.key, [right.snapshotId]),
  ])
  return [
    leftScans.get(left.snapshotId) ?? EMPTY_SCAN,
    rightScans.get(right.snapshotId) ?? EMPTY_SCAN,
  ]
}

/**
 * 좌우 스냅샷 비교.
 *
 * 제외 목록은 **비교가 끝난 결과 위에** 얹는다 (`applyExclusions`). 훑기에서 걸러 내면
 * 두 가지를 잃는다 — 접어 둔 자리에 변경이 들어왔는지 알 수 없게 되고(이 도구에서는
 * 그게 사고로 이어진다), 규칙을 한 줄 고칠 때마다 캐시가 갈려 폴더를 다시 훑게 된다.
 * 대신 읽기·diff 비용은 줄지 않는다 — 접기는 **목록을 정리하는 일**이지 비교를 아끼는
 * 일이 아니다. 아예 읽지 않으려면 `change/config.ts` 의 `SCAN` 으로 대상 자체를 좁힌다.
 */
export async function compareSnapshots(
  cfg: RepositoryConfig,
  left: SideRef,
  right: SideRef,
  options: DiffOptions = DEFAULT_OPTIONS,
  exclude: ExcludeState = NO_EXCLUDE
): Promise<ComparisonResponse> {
  const key = cacheKey(left, right, options)
  const cached = comparisonCache.get(key)
  if (cached) return applyExclusions(cached, exclude)

  const [leftScan, rightScan] = await scanBothSides(cfg, left, right)

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
      const leftFile = leftByPath.get(relPath)
      const rightFile = rightByPath.get(relPath)

      if (leftFile) leftWanted.push(relPath)
      if (!rightFile) continue
      // 내용이 같으면 한쪽만 받아 양쪽에 쓴다 — 전송량이 절반이 된다.
      // 통계(총 줄 수·문자 수)는 동일한 파일에서도 요약 카드에 들어가므로
      // 읽기를 아예 건너뛸 수는 없다. 두 번 받지 않는 것까지가 여기서 할 수 있는 일이다.
      if (leftFile && sameContent(leftFile, rightFile)) mirrored.add(relPath)
      else rightWanted.push(relPath)
    }

    // 본문을 **한 번에 몰아서** 받는다. 파일마다 따로 물어보면 SSH 왕복이 파일 수에 비례한다.
    const [leftTexts, rightTexts] = await Promise.all([
      readFileTexts(left.source, left.snapshotId, leftWanted),
      readFileTexts(right.source, right.snapshotId, rightWanted),
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
    left: left.snapshotId,
    right: right.snapshotId,
    packages: buildPackageChanges(files),
    files,
    skipped: leftScan.skipped + rightScan.skipped,
    exclude: { file: '', rules: 0, files: 0, changed: 0, error: null },
  }
  // 캐시에는 **접기 전** 결과를 둔다 — 규칙 파일을 고쳐도 다시 비교하지 않아도 되게
  comparisonCache.set(key, response)
  return applyExclusions(response, exclude)
}

/**
 * 비교 결과에 제외 목록을 얹는다. **순수 함수** — 받은 응답을 고치지 않는다
 * (캐시에 든 결과를 그대로 재사용하므로 여기서 손대면 다음 요청이 오염된다).
 *
 * 걸린 파일은 목록에 **남긴 채** 표시만 한다. 대신 패키지 요약은 접어 둔 것을 빼고
 * 다시 만든다 — 사이드바에 "12개 변경" 이라 떠 있는데 목록에는 9개만 보이면
 * 사용자는 나머지 3개를 찾아 헤맨다.
 *
 * 규칙이 하나도 없고 오류도 없으면 **받은 응답을 그대로** 돌려준다 (기본 경로에서
 * 배열을 두 번 훑지 않는다).
 */
export function applyExclusions(
  response: ComparisonResponse,
  exclude: ExcludeState
): ComparisonResponse {
  if (exclude.list.isEmpty && exclude.error === null && !exclude.file) return response

  const files = response.files.map((file) => {
    const rule = exclude.list.matches(file.path)
    return rule === null ? file : { ...file, excluded: true, excludedBy: rule }
  })

  const folded = files.filter((f) => f.excluded)

  return {
    ...response,
    files,
    packages: buildPackageChanges(files.filter((f) => !f.excluded)),
    exclude: {
      file: exclude.file,
      rules: exclude.list.size,
      files: folded.length,
      // 접어 둔 자리에 들어온 변경 — 이 숫자를 눈에 띄게 알리는 것이 이 기능의 안전장치다
      changed: folded.filter((f) => f.status !== 'same').length,
      error: exclude.error,
    },
  }
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
    // 접기는 비교가 끝난 뒤에 얹는다 (`applyExclusions`) — 여기서는 늘 펼친 상태다
    excluded: false,
    excludedBy: null,
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
 *
 * **받은 파일들만 보고 만든다.** 어느 쪽에 있던 패키지인지는 파일 상태로 알 수 있어
 * (`added` 는 오른쪽에만, `removed` 는 왼쪽에만) 훑기 결과를 따로 받을 필요가 없다.
 * 그래야 접어 둔 파일을 뺀 뒤 **같은 함수로 다시** 만들 수 있다 — 요약과 화면에 보이는
 * 목록이 어긋나지 않게 하는 것이 이 기능에서 제일 틀리기 쉬운 자리다.
 */
function buildPackageChanges(files: readonly ComparedFile[]): PackageChange[] {
  const leftPackages = new Set(
    files.filter((f) => f.status !== 'added').map((f) => f.packageName)
  )
  const rightPackages = new Set(
    files.filter((f) => f.status !== 'removed').map((f) => f.packageName)
  )

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
  left: SideRef,
  right: SideRef,
  relPath: string
): Promise<FileContentResponse> {
  const [leftTexts, rightTexts] = await Promise.all([
    readFileTexts(left.source, left.snapshotId, [relPath]),
    readFileTexts(right.source, right.snapshotId, [relPath]),
  ])
  return {
    path: relPath,
    leftText: leftTexts.get(relPath) ?? null,
    rightText: rightTexts.get(relPath) ?? null,
  }
}
