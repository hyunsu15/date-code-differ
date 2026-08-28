import type { CharRange, CodeMatch, DiffRow, RowMatches, SearchOptions, SearchResult } from '../types.ts'

/** 한 번에 찾을 결과 상한 — 병적인 패턴에서 화면이 멈추는 것을 막는다 */
export const MAX_MATCHES = 5000
/** 한 줄에서 찾을 결과 상한 */
const MAX_PER_LINE = 500

const EMPTY: SearchResult = { matches: [], byRow: new Map(), error: null, truncated: false }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 검색 옵션으로 정규식을 만든다. 잘못된 정규식이면 오류 메시지를 돌려준다. */
function buildRegExp(opts: SearchOptions): { re: RegExp } | { error: string } {
  const flags = opts.caseSensitive ? 'g' : 'gi'
  const source = opts.regex ? opts.query : escapeRegExp(opts.query)
  try {
    return { re: new RegExp(source, flags) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

function findInLine(re: RegExp, text: string): CharRange[] {
  if (!text) return []
  re.lastIndex = 0
  const out: CharRange[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    // 길이 0 매치(`a*` 등)는 커서를 직접 밀지 않으면 무한 루프에 빠진다
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    out.push([m.index, m.index + m[0].length])
    if (out.length >= MAX_PER_LINE) break
  }
  return out
}

/**
 * diff 행들에서 검색어를 찾는다.
 * 접혀 있는 구간도 모두 훑는다 — 결과 개수가 펼침 상태에 따라 달라지면 혼란스럽기 때문.
 */
export function searchRows(rows: DiffRow[], opts: SearchOptions): SearchResult {
  if (!opts.query) return EMPTY

  const built = buildRegExp(opts)
  if ('error' in built) return { matches: [], byRow: new Map(), error: built.error, truncated: false }
  const { re } = built

  const matches: CodeMatch[] = []
  const byRow = new Map<number, RowMatches>()
  let truncated = false

  for (let i = 0; i < rows.length && !truncated; i++) {
    const row = rows[i]
    const a = row.aText ? findInLine(re, row.aText) : []
    const b = row.bText ? findInLine(re, row.bText) : []
    if (!a.length && !b.length) continue

    byRow.set(i, { a, b })
    // 같은 행이면 왼쪽 먼저 — 위에서 아래로 자연스럽게 넘어가도록
    for (const [start, end] of a) {
      matches.push({ row: i, side: 'a', start, end })
      if (matches.length >= MAX_MATCHES) truncated = true
    }
    for (const [start, end] of b) {
      matches.push({ row: i, side: 'b', start, end })
      if (matches.length >= MAX_MATCHES) truncated = true
    }
  }

  return { matches, byRow, error: null, truncated }
}
