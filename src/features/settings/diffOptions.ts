import { DEFAULT_OPTIONS } from '../../lib/normalize.ts'
import type { DiffOptions } from '../../types.ts'

/**
 * 무시 옵션 — 무엇을 "같은 줄" 로 볼지.
 *
 * **처음부터 켜져 있다.** 이 도구로 운영과 테스트를 견줄 때 보고 싶은 것은 로직 차이지
 * 들여쓰기·빈 줄·머리말이 아니다. 꺼진 채로 열면 그 군더더기가 목록 맨 앞을 채워,
 * 정작 봐야 할 파일이 뒤로 밀린다. 필요하면 화면에서 하나씩 끄면 된다.
 *
 * 대소문자만 꺼 둔다 — C 와 PL/SQL 에서 `Total` 과 `total` 은 서로 다른 이름이라,
 * 켜 두면 진짜 차이를 덮어 버린다.
 *
 * 고른 값은 이 브라우저의 localStorage 에만 남는다 (`change/config.ts` 와 무관하다).
 * 비교 옵션 자체의 뜻은 `src/lib/normalize.ts` 가 갖고 있고, 여기서는 **기본값과
 * 저장**만 맡는다.
 */

const STORAGE_KEY = 'cd-ignore'

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  ignoreWhitespace: true,
  ignoreCase: false,
  ignoreBlankLines: true,
  ignoreComments: true,
  ignoreAuthor: true,
}

/** 옵션 이름들 — 저장값을 훑을 때 기준이 된다 */
const KEYS = Object.keys(DEFAULT_OPTIONS) as (keyof DiffOptions)[]

/**
 * 저장값을 옵션으로 바꾼다.
 *
 * 저장값은 사용자가 직접 고칠 수 있고, 옵션이 나중에 늘어나기도 한다
 * (`ignoreAuthor` 가 그랬다). 항목마다 따로 보고 **없거나 불리언이 아니면 기본값**을
 * 쓴다 — 옵션 하나가 이상하다고 나머지 선택까지 날리지 않기 위해서다.
 */
export function parseDiffOptions(raw: string | null): DiffOptions {
  if (!raw) return DEFAULT_DIFF_OPTIONS

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_DIFF_OPTIONS
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_DIFF_OPTIONS

  const value = parsed as Record<string, unknown>
  const out = { ...DEFAULT_DIFF_OPTIONS }
  for (const key of KEYS) {
    if (typeof value[key] === 'boolean') out[key] = value[key]
  }
  return out
}

export function loadDiffOptions(): DiffOptions {
  try {
    return parseDiffOptions(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_DIFF_OPTIONS // 저장소 접근 자체가 막힌 브라우저
  }
}

export function saveDiffOptions(options: DiffOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}
