import type { ExcludeList } from '../src/lib/excludeList.ts'
import type { SnapshotChange } from '../src/types.ts'
import {
  listSnapshots,
  readFileTexts,
  scanSnapshots,
  type RepositoryConfig,
  type SnapshotFile,
} from './snapshotRepository.ts'
import type { SnapshotSource } from './source/types.ts'

/**
 * 날짜마다 **바로 앞 날짜와 견줘** 무엇이 바뀌었는지 센다 — 날짜 고르기 목록에 "변경 N개" 를 붙이고,
 * 바뀐 날짜만 추려 보이게 하려는 것.
 *
 * 날짜 폴더는 배포가 없던 날에도 쌓인다. 그런 날은 앞 날짜와 똑같아서, 고르면 앞 날짜를 고른 것과
 * 결과가 같다. 그런 날이 목록을 채우면 정작 배포가 있던 날을 찾기 어렵다.
 *
 * **파일 단위**로 센다(내용이 한 바이트라도 다르면 변경). 화면의 무시 옵션(공백·주석)은 적용하지
 * 않는다 — 그러려면 날짜 쌍마다 본문을 다 읽어 diff 해야 해서 목록 하나 띄우는 데 너무 비싸다.
 * 팀 제외 목록에 걸린 파일은 뺀다 — 늘 바뀌는 임시 파일 때문에 모든 날짜가 "변경" 으로 뜨지 않게.
 *
 * 비용: SSH 는 날짜 목록을 만들 때 이미 받아 둔 체크섬으로 가른다 — **추가 접속이 없다.**
 * 로컬은 체크섬이 없어(`localSource` 주석) 크기가 같은 파일만 본문을 읽어 견준다. 한 번 센 쌍은
 * 캐시에 남는다(날짜 폴더는 바뀌지 않는다. ⟳ 새로고침이 비운다).
 */

/** 두 목록의 차이 — 경로 목록으로 둔다(제외 규칙은 나중에 얹는다) */
export interface ListDiff {
  added: string[]
  removed: string[]
  modified: string[]
  /** 크기는 같은데 체크섬이 없어 본문을 봐야 가를 수 있는 경로 */
  unsure: string[]
}

/**
 * 앞 날짜 목록과 이 날짜 목록을 견준다 — **순수 함수**.
 * 크기가 다르면 바뀐 것, 체크섬이 둘 다 있으면 그걸로, 없으면 `unsure` 로 넘긴다.
 */
export function diffLists(prev: readonly SnapshotFile[], cur: readonly SnapshotFile[]): ListDiff {
  const before = new Map(prev.map((f) => [f.path, f]))
  const out: ListDiff = { added: [], removed: [], modified: [], unsure: [] }

  for (const file of cur) {
    const old = before.get(file.path)
    before.delete(file.path)
    if (!old) out.added.push(file.path)
    else if (old.size !== file.size) out.modified.push(file.path)
    else if (old.checksum !== null && file.checksum !== null) {
      if (old.checksum !== file.checksum) out.modified.push(file.path)
    } else out.unsure.push(file.path)
  }
  out.removed.push(...before.keys())
  return out
}

/** 제외 규칙을 얹어 센다. 걸린 경로는 세지 않는다 */
export function countChanges(
  diff: Omit<ListDiff, 'unsure'>,
  exclude: ExcludeList,
  id: string,
  base: string | null
): SnapshotChange {
  const kept = (paths: readonly string[]): number => paths.filter((p) => exclude.matches(p) === null).length
  return {
    id,
    base,
    added: kept(diff.added),
    removed: kept(diff.removed),
    modified: kept(diff.modified),
  }
}

/** 한 번 가른 날짜 쌍 — `${소스} ${앞날짜}>${이날짜}` */
const pairCache = new Map<string, Omit<ListDiff, 'unsure'>>()

export function clearChangeCache(): void {
  pairCache.clear()
}

/** 본문을 몰아 받는 묶음 크기 — `comparisonService` 와 같은 이유로 끊는다 */
const READ_BATCH = 200

/** 크기는 같고 체크섬이 없는 파일들을 본문으로 가른다 */
async function settle(
  source: SnapshotSource,
  prevId: string,
  curId: string,
  unsure: readonly string[]
): Promise<string[]> {
  const changed: string[] = []
  for (let i = 0; i < unsure.length; i += READ_BATCH) {
    const batch = unsure.slice(i, i + READ_BATCH)
    const [before, after] = await Promise.all([
      readFileTexts(source, prevId, batch),
      readFileTexts(source, curId, batch),
    ])
    for (const p of batch) if (before.get(p) !== after.get(p)) changed.push(p)
  }
  return changed
}

/**
 * 날짜마다 바로 앞 날짜 대비 변경 수. 순서는 날짜 목록과 같다(최신순).
 * 가장 오래된 날짜는 견줄 앞이 없어 `base: null` 이고, 들어 있는 파일 전체를 "추가" 로 센다.
 */
export async function listSnapshotChanges(
  source: SnapshotSource,
  cfg: RepositoryConfig,
  key: string,
  exclude: ExcludeList
): Promise<SnapshotChange[]> {
  const items = await listSnapshots(source, cfg, key)
  // 목록을 만들 때 이미 훑어 캐시에 있다 — 여기서 다시 접속하지 않는다
  const scans = await scanSnapshots(source, cfg, key, items.map((s) => s.id))
  const filesOf = (id: string): SnapshotFile[] => scans.get(id)?.files ?? []

  const out: SnapshotChange[] = []
  for (let i = 0; i < items.length; i++) {
    const cur = items[i].id
    const prev = items[i + 1]?.id ?? null
    if (prev === null) {
      out.push(countChanges({ added: filesOf(cur).map((f) => f.path), removed: [], modified: [] }, exclude, cur, null))
      continue
    }

    const cacheKey = `${key} ${prev}>${cur}`
    let diff = pairCache.get(cacheKey)
    if (!diff) {
      const raw = diffLists(filesOf(prev), filesOf(cur))
      const settled = raw.unsure.length > 0 ? await settle(source, prev, cur, raw.unsure) : []
      diff = { added: raw.added, removed: raw.removed, modified: [...raw.modified, ...settled] }
      pairCache.set(cacheKey, diff)
    }
    out.push(countChanges(diff, exclude, cur, prev))
  }
  return out
}
