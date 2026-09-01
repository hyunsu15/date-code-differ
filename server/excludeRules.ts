import { ExcludeList } from '../src/lib/excludeList.ts'
import type { SnapshotSource } from './source/types.ts'

/**
 * 제외 목록 파일을 소스에서 읽어 규칙으로 만든다.
 *
 * 파일은 **비교 대상과 같은 곳**에 있다 (로컬이면 이 PC, SSH 면 원격). 소스가 이미
 * 그 자리를 읽을 줄 알므로 여기서는 경로를 넘기고 본문을 받기만 한다.
 *
 * **읽기에 실패해도 비교는 계속한다.** 규칙 파일 하나 때문에 좌우 비교가 통째로 죽으면
 * 정작 봐야 할 것을 못 본다. 대신 실패를 응답에 실어(`error`) 화면이 알리게 한다 —
 * 조용히 "규칙 0개" 로 넘어가면 접힌 줄 알았던 파일이 그냥 다 보이게 되고,
 * 반대로 접힌 줄 알고 지나칠 수도 있다.
 */

/** 한 번 읽어 둔 규칙 — 어디서 왔고, 실패했다면 왜인지까지 함께 든다 */
export interface ExcludeState {
  /** 설정에 적힌 경로 그대로 (화면에 보여준다) */
  file: string
  list: ExcludeList
  error: string | null
}

/** 제외 목록을 쓰지 않는 상태 */
export const NO_EXCLUDE: ExcludeState = { file: '', list: ExcludeList.EMPTY, error: null }

/**
 * 읽어 둔 규칙 캐시.
 *
 * 비교 요청마다 원격에 물어보면 SSH 왕복이 하나씩 는다. 대신 **파일을 고쳐도 바로
 * 반영되지는 않는다** — 화면의 새로고침(`?refresh=1`)이 이 캐시를 비운다.
 * 실패도 함께 캐시한다 (없는 경로를 요청마다 다시 물어볼 이유가 없다).
 */
const cache = new Map<string, ExcludeState>()

export function clearExcludeCache(): void {
  cache.clear()
}

export async function loadExcludeList(
  source: SnapshotSource,
  sourceKey: string,
  file: string | undefined,
  separators: readonly string[]
): Promise<ExcludeState> {
  const target = (file ?? '').trim()
  if (!target) return NO_EXCLUDE

  const key = `${sourceKey} ${target}`
  const cached = cache.get(key)
  if (cached) return cached

  const state = await read(source, target, separators)
  cache.set(key, state)
  return state
}

async function read(
  source: SnapshotSource,
  target: string,
  separators: readonly string[]
): Promise<ExcludeState> {
  try {
    const raw = await source.readTextFile(target)
    if (raw === null) {
      return fail(target, `제외 목록 파일을 찾을 수 없습니다: ${target}`)
    }
    return { file: target, list: ExcludeList.parse(raw, separators), error: null }
  } catch (e) {
    return fail(target, `제외 목록 파일을 읽지 못했습니다.\n${(e as Error).message}`)
  }
}

const fail = (file: string, error: string): ExcludeState => ({
  file,
  list: ExcludeList.EMPTY,
  error,
})
