import type { DiffOptions } from '../types.ts'

/**
 * 비교 옵션에 따라 라인을 "비교용 키"로 정규화한다.
 * 정규화된 키가 같으면 두 라인은 동일한 것으로 간주된다.
 * 화면에는 항상 원본 라인이 그대로 표시된다.
 */

const LINE_COMMENT = /^\s*(\/\/|#|--|;)/
const BLOCK_COMMENT_ONLY = /^\s*(\/\*.*\*\/|\/\*|\*|\*\/)\s*$/

export const DEFAULT_OPTIONS: DiffOptions = {
  ignoreWhitespace: false,
  ignoreCase: false,
  ignoreBlankLines: false,
  ignoreComments: false,
}

export function normalizeLine(line: string, opts: DiffOptions): string {
  let s = line
  if (opts.ignoreWhitespace) s = s.replace(/\s+/g, ' ').trim()
  if (opts.ignoreCase) s = s.toLowerCase()
  return s
}

/** 비교 대상에서 아예 빼버릴 라인인지 (빈 줄 / 주석 전용 줄) */
export function isDroppedLine(line: string, opts: DiffOptions): boolean {
  if (opts.ignoreBlankLines && line.trim() === '') return true
  if (opts.ignoreComments) {
    const t = line.trim()
    if (t !== '' && (LINE_COMMENT.test(line) || BLOCK_COMMENT_ONLY.test(line))) return true
  }
  return false
}
