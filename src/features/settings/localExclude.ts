import { DEFAULT_EXCLUDE_SEPARATORS, ExcludeList } from '../../lib/excludeList.ts'
import type { ComparedFile } from '../../types.ts'

/**
 * **내 제외 목록** — 화면에서 바로 접고, 이 브라우저에만 남는다.
 *
 * 프리셋의 `excludeFile` 과 목적이 다르다. 그쪽은 **팀이 함께 쓰는** 규칙이라
 * 자동생성물·벤더 코드처럼 "누가 봐도 볼 필요 없는" 것을 적는 자리다. 그래서 파일에
 * 두고, 고치려면 파일을 열어 고친 다음 새로고침해야 한다 — SSH 로 볼 때는 그 파일이
 * 원격에 있어서 손댈 수도 없다.
 *
 * 그런데 실제로 자주 필요한 것은 그게 아니다. **"지금 이 파일은 안 볼래"** 다.
 * 내가 지금 보고 있는 변경과 상관없는 파일 두어 개를 잠깐 치우는 일에 팀 규칙 파일을
 * 고칠 수는 없다. 그래서 이 목록을 따로 둔다.
 *
 * | | 프리셋의 `excludeFile` | 내 제외 목록 |
 * | --- | --- | --- |
 * | 어디에 | 소스와 같은 자리의 txt | 이 브라우저 (localStorage) |
 * | 누가 | 팀 전체 | 나만 |
 * | 고치려면 | 파일 수정 + 새로고침 | 목록에서 한 번 누르기 |
 *
 * **거르는 게 아니라 접는 것은 양쪽이 같다.** 걸린 파일도 비교는 그대로 하고 목록에서만
 * 접어 둔다 — 접어 둔 자리에 진짜 변경이 들어와도 "제외 N · 변경 M" 으로 늘 알린다.
 *
 * 판정 규칙(`*` 글로브 · 폴더 이름 · `#` 설명)은 `src/lib/excludeList.ts` 하나를 그대로
 * 쓴다. 두 목록이 다른 문법을 갖게 두면 어느 쪽에 무엇을 적었는지 기억해야 한다.
 */

const STORAGE_KEY = 'cd-my-exclude'

export function loadLocalExclude(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return '' // 저장소 접근 자체가 막힌 브라우저
  }
}

export function saveLocalExclude(text: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, text)
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}

/** 목록 원문을 규칙으로 */
export const parseLocalExclude = (text: string): ExcludeList =>
  ExcludeList.parse(text, DEFAULT_EXCLUDE_SEPARATORS)

/**
 * 경로 하나를 목록에 넣거나 뺀다.
 *
 * **뺄 때는 그 경로가 아니라 걸린 규칙을 지운다.** `*_common.h` 같은 글로브에 걸려
 * 접힌 파일에서 "펼치기" 를 누르면, 경로만 지워서는 아무 일도 안 일어나 버튼이 고장 난
 * 것처럼 보인다. 걸리게 만든 줄을 지워야 실제로 펼쳐진다.
 *
 * @returns 새 목록 원문 (줄바꿈으로 구분)
 */
export function toggleLocalExclude(text: string, path: string): string {
  const matched = parseLocalExclude(text).matches(path)

  if (matched === null) {
    const trimmed = text.trimEnd()
    return trimmed ? `${trimmed}\n${path}` : path
  }

  // 걸린 규칙과 같은 줄을 전부 뺀다 (쉼표로 이어 적은 경우도 조각 단위로 본다)
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .split(',')
        .filter((piece) => piece.trim() !== matched)
        .join(',')
    )
    .filter((line, i, all) => line.trim() !== '' || (i > 0 && all[i - 1].trim() !== ''))
    .join('\n')
    .trim()
}

/** 서버가 접은 것 위에 내 목록을 얹은 결과 */
export interface LocalExcludeResult {
  files: ComparedFile[]
  /** 양쪽을 합쳐 접힌 파일 수 */
  excluded: number
  /** 그중 실제로 바뀐 파일 수 — 0 이 아니면 눈에 띄게 알린다 */
  excludedChanged: number
  /** 그중 내 목록 때문에 접힌 수 */
  byMine: number
}

/**
 * 내 목록을 비교 결과에 얹는다.
 *
 * 서버가 이미 접어 둔 파일(`excluded`)은 그대로 두고, 안 접힌 것 중 내 규칙에
 * 걸리는 것만 더 접는다. 두 목록이 같은 파일을 가리켜도 한 번만 센다.
 */
export function applyLocalExclude(
  files: readonly ComparedFile[],
  text: string
): LocalExcludeResult {
  const list = parseLocalExclude(text)

  let excluded = 0
  let excludedChanged = 0
  let byMine = 0

  const next = files.map((file) => {
    const mine = file.excluded ? null : list.matches(file.path)
    const isExcluded = file.excluded || mine !== null

    if (isExcluded) {
      excluded += 1
      if (file.status !== 'same') excludedChanged += 1
      if (mine !== null) byMine += 1
    }
    if (mine === null) return file

    return { ...file, excluded: true, excludedBy: mine, excludedLocal: true }
  })

  return { files: next, excluded, excludedChanged, byMine }
}
