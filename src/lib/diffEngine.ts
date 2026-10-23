import { diffArrays } from 'diff'
import { splitLines, tokenizeCode } from './tokenize.ts'
import { DEFAULT_OPTIONS, markDroppedLines, normalizeLine } from './normalize.ts'
import type {
  CharRange,
  DiffOptions,
  DiffRow,
  DiffStats,
  FileDiff,
  Hunk,
  RenderBlock,
} from '../types.ts'

export const MAX_LINES = 60000

/** id 부여 전의 행 */
type RowDraft = Omit<DiffRow, 'id'>

/* ------------------------------------------------------------------ */
/* 단어(토큰) 단위 diff                                                 */
/* ------------------------------------------------------------------ */

function tokenKey(tok: string, opts: DiffOptions): string {
  let t = tok
  if (opts.ignoreWhitespace && /^\s+$/.test(t)) return ' '
  if (opts.ignoreCase) t = t.toLowerCase()
  return t
}

const nonWsLen = (s: string): number => s.replace(/\s+/g, '').length

export interface WordDiff {
  aRanges: CharRange[]
  bRanges: CharRange[]
  commonA: number
  commonB: number
  /** 공백을 뺀 공통 문자 수 — "의미 있는 겹침" 판정용 */
  commonNonWsA: number
  commonNonWsB: number
}

/**
 * 두 라인의 단어 단위 차이를 구한다.
 * commonNonWs* 는 들여쓰기만 같은 줄이 비슷해 보이는 것을 막기 위한 값이다.
 */
export function diffWithinLine(aLine: string, bLine: string, opts: DiffOptions): WordDiff {
  const aTok = tokenizeCode(aLine)
  const bTok = tokenizeCode(bLine)
  const parts = diffArrays(aTok, bTok, {
    comparator: (l, r) => tokenKey(l, opts) === tokenKey(r, opts),
  })

  const aRanges: CharRange[] = []
  const bRanges: CharRange[] = []
  let aTokIdx = 0
  let bTokIdx = 0
  let aPos = 0
  let bPos = 0
  let commonA = 0
  let commonB = 0
  let commonNonWsA = 0
  let commonNonWsB = 0

  const push = (arr: CharRange[], start: number, end: number): void => {
    if (end <= start) return
    const last = arr[arr.length - 1]
    if (last && last[1] === start) last[1] = end
    else arr.push([start, end])
  }
  const spanOf = (toks: string[], from: number, count: number): number => {
    let n = 0
    for (let i = 0; i < count; i++) n += (toks[from + i] ?? '').length
    return n
  }
  const spanNonWs = (toks: string[], from: number, count: number): number => {
    let n = 0
    for (let i = 0; i < count; i++) n += nonWsLen(toks[from + i] ?? '')
    return n
  }

  // jsdiff 의 equal 파트 value 는 B(new) 쪽 토큰이라 A 길이를 신뢰할 수 없다.
  // 양쪽 토큰 커서를 직접 굴려 각 측 문자 길이를 따로 센다.
  for (const part of parts) {
    const count = part.count ?? part.value.length
    if (part.added) {
      const len = spanOf(bTok, bTokIdx, count)
      push(bRanges, bPos, bPos + len)
      bPos += len
      bTokIdx += count
    } else if (part.removed) {
      const len = spanOf(aTok, aTokIdx, count)
      push(aRanges, aPos, aPos + len)
      aPos += len
      aTokIdx += count
    } else {
      const la = spanOf(aTok, aTokIdx, count)
      const lb = spanOf(bTok, bTokIdx, count)
      commonA += la
      commonB += lb
      commonNonWsA += spanNonWs(aTok, aTokIdx, count)
      commonNonWsB += spanNonWs(bTok, bTokIdx, count)
      aPos += la
      bPos += lb
      aTokIdx += count
      bTokIdx += count
    }
  }

  return { aRanges, bRanges, commonA, commonB, commonNonWsA, commonNonWsB }
}

/* ------------------------------------------------------------------ */
/* 파일 단위 diff                                                       */
/* ------------------------------------------------------------------ */

/**
 * @param aText 왼쪽(이전 스냅샷) 코드
 * @param bText 오른쪽(이후 스냅샷) 코드
 */
export function buildFileDiff(
  aText: string | null | undefined,
  bText: string | null | undefined,
  options: DiffOptions = DEFAULT_OPTIONS
): FileDiff {
  const opts: DiffOptions = { ...DEFAULT_OPTIONS, ...options }
  const aAll = splitLines(aText ?? '')
  const bAll = splitLines(bText ?? '')

  if (aAll.length + bAll.length > MAX_LINES) {
    return {
      tooLarge: true,
      rows: [],
      hunks: [],
      stats: emptyStats(aAll.length, bAll.length),
    }
  }

  // 1) 무시 대상 라인 걸러내기 — 여러 줄 주석 때문에 줄 하나씩이 아니라 파일 단위로 본다
  const aDrop = markDroppedLines(aAll, opts)
  const bDrop = markDroppedLines(bAll, opts)
  const aKeep: number[] = []
  const bKeep: number[] = []
  const aDropped = new Set<number>()
  const bDropped = new Set<number>()
  aAll.forEach((_, i) => (aDrop[i] ? aDropped.add(i) : aKeep.push(i)))
  bAll.forEach((_, i) => (bDrop[i] ? bDropped.add(i) : bKeep.push(i)))

  const aKeys = aKeep.map((i) => normalizeLine(aAll[i], opts))
  const bKeys = bKeep.map((i) => normalizeLine(bAll[i], opts))

  // 2) 라인 단위 LCS diff
  const parts = diffArrays(aKeys, bKeys)

  // 3) 정렬된 행 목록 만들기
  const core: RowDraft[] = []
  let ai = 0 // aKeep 커서
  let bi = 0 // bKeep 커서
  let pi = 0

  while (pi < parts.length) {
    const part = parts[pi]

    if (!part.added && !part.removed) {
      const count = part.count ?? part.value.length
      for (let k = 0; k < count; k++) {
        core.push(makeEqualRow(aAll, bAll, aKeep[ai++], bKeep[bi++]))
      }
      pi++
      continue
    }

    // 삭제 블록 + (바로 뒤) 추가 블록 → 수정으로 짝지음
    let removedCount = 0
    let addedCount = 0
    if (part.removed) {
      removedCount = part.count ?? part.value.length
      pi++
      const nextPart = parts[pi]
      if (nextPart?.added) {
        addedCount = nextPart.count ?? nextPart.value.length
        pi++
      }
    } else {
      addedCount = part.count ?? part.value.length
      pi++
    }

    const pairCount = Math.min(removedCount, addedCount)
    for (let k = 0; k < pairCount; k++) {
      core.push(makeModifyRow(aAll, bAll, aKeep[ai++], bKeep[bi++], opts))
    }
    for (let k = pairCount; k < removedCount; k++) {
      const idx = aKeep[ai++]
      core.push({
        kind: 'remove',
        aNo: idx + 1,
        bNo: null,
        aText: aAll[idx],
        bText: null,
        aRanges: null,
        bRanges: null,
      })
    }
    for (let k = pairCount; k < addedCount; k++) {
      const idx = bKeep[bi++]
      core.push({
        kind: 'add',
        aNo: null,
        bNo: idx + 1,
        aText: null,
        bText: bAll[idx],
        aRanges: null,
        bRanges: null,
      })
    }
  }

  // 4) 무시했던 라인을 원래 위치에 되돌려 넣기 (표시 전용, 통계 제외)
  const drafts =
    aDropped.size > 0 || bDropped.size > 0
      ? reinsertDropped(core, aAll, bAll, aDropped, bDropped)
      : core

  const rows: DiffRow[] = drafts.map((r, i) => ({ ...r, id: i }))

  // 5) diff 포인트(hunk) 묶기 + 통계
  return {
    tooLarge: false,
    rows,
    hunks: buildHunks(rows),
    stats: computeStats(rows, aAll, bAll),
  }
}

function makeEqualRow(aAll: string[], bAll: string[], aIdx: number, bIdx: number): RowDraft {
  return {
    kind: 'equal',
    aNo: aIdx + 1,
    bNo: bIdx + 1,
    aText: aAll[aIdx],
    bText: bAll[bIdx],
    aRanges: null,
    bRanges: null,
  }
}

/** 이 비율 밑으로 겹치면 서로 무관한 줄로 보고 줄 전체를 칠한다 */
const WHOLE_LINE_THRESHOLD = 0.1

function makeModifyRow(
  aAll: string[],
  bAll: string[],
  aIdx: number,
  bIdx: number,
  opts: DiffOptions
): RowDraft {
  const aText = aAll[aIdx]
  const bText = bAll[bIdx]
  const w = diffWithinLine(aText, bText, opts)

  // 공백을 뺀 "의미 있는" 겹침 비율로 판단한다.
  // 들여쓰기·구두점만 같은 줄이 비슷해 보이는 것을 막기 위함.
  const meaningful = w.commonNonWsA + w.commonNonWsB
  const total = nonWsLen(aText) + nonWsLen(bText)
  const related = total === 0 || meaningful / total >= WHOLE_LINE_THRESHOLD

  const whole = (text: string): CharRange[] => (text.length ? [[0, text.length]] : [])

  return {
    kind: 'modify',
    aNo: aIdx + 1,
    bNo: bIdx + 1,
    aText,
    bText,
    // 표시용 구간만 통짜로 바꾸고, 통계는 실제 토큰 diff 값을 그대로 쓴다
    aRanges: related ? w.aRanges : whole(aText),
    bRanges: related ? w.bRanges : whole(bText),
    commonA: w.commonA,
    commonB: w.commonB,
  }
}

/** 무시 옵션으로 빠졌던 라인들을 원래 순서대로 끼워 넣는다. */
function reinsertDropped(
  core: RowDraft[],
  aAll: string[],
  bAll: string[],
  aDropped: Set<number>,
  bDropped: Set<number>
): RowDraft[] {
  const out: RowDraft[] = []
  let aCursor = 0
  let bCursor = 0

  const flush = (aUntil: number, bUntil: number): void => {
    const pendingA: number[] = []
    const pendingB: number[] = []
    while (aCursor < aUntil) {
      if (aDropped.has(aCursor)) pendingA.push(aCursor)
      aCursor++
    }
    while (bCursor < bUntil) {
      if (bDropped.has(bCursor)) pendingB.push(bCursor)
      bCursor++
    }
    const n = Math.max(pendingA.length, pendingB.length)
    for (let i = 0; i < n; i++) {
      const a = pendingA[i]
      const b = pendingB[i]
      out.push({
        kind: 'ignored',
        aNo: a != null ? a + 1 : null,
        bNo: b != null ? b + 1 : null,
        aText: a != null ? aAll[a] : null,
        bText: b != null ? bAll[b] : null,
        aRanges: null,
        bRanges: null,
      })
    }
  }

  for (const row of core) {
    flush(row.aNo != null ? row.aNo - 1 : aCursor, row.bNo != null ? row.bNo - 1 : bCursor)
    if (row.aNo != null) aCursor = row.aNo
    if (row.bNo != null) bCursor = row.bNo
    out.push(row)
  }
  flush(aAll.length, bAll.length)
  return out
}

/* ------------------------------------------------------------------ */
/* diff 포인트                                                          */
/* ------------------------------------------------------------------ */

const isChanged = (r: DiffRow): boolean =>
  r.kind === 'add' || r.kind === 'remove' || r.kind === 'modify'

function buildHunks(rows: DiffRow[]): Hunk[] {
  const hunks: Hunk[] = []
  let cur: Hunk | null = null

  rows.forEach((row, i) => {
    if (isChanged(row)) {
      if (!cur) {
        cur = {
          index: hunks.length,
          rowStart: i,
          rowEnd: i,
          aStart: row.aNo,
          bStart: row.bNo,
          add: 0,
          del: 0,
          mod: 0,
          preview: '',
        }
        hunks.push(cur)
      }
      cur.rowEnd = i
      if (cur.aStart == null) cur.aStart = row.aNo
      if (cur.bStart == null) cur.bStart = row.bNo
      if (row.kind === 'add') cur.add++
      else if (row.kind === 'remove') cur.del++
      else cur.mod++
      if (!cur.preview) {
        const t = (row.bText ?? row.aText ?? '').trim()
        cur.preview = t.length > 68 ? `${t.slice(0, 68)}…` : t
      }
    } else if (row.kind !== 'ignored') {
      cur = null
    }
  })

  return hunks
}

/**
 * 접기(gap) 계산 — 변경 지점 주변 context 줄만 남기고 나머지는 접는다.
 * context 가 음수면 전부 펼친다.
 */
export function buildBlocks(
  rows: DiffRow[],
  context: number,
  expandedGaps: ReadonlySet<number>
): RenderBlock[] {
  if (context < 0) return rows.length ? [{ kind: 'rows', from: 0, to: rows.length - 1 }] : []

  const visible = new Array<boolean>(rows.length).fill(false)
  rows.forEach((row, i) => {
    if (!isChanged(row)) return
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) {
      visible[k] = true
    }
  })

  const blocks: RenderBlock[] = []
  let i = 0
  while (i < rows.length) {
    if (visible[i]) {
      const from = i
      while (i < rows.length && visible[i]) i++
      blocks.push({ kind: 'rows', from, to: i - 1 })
    } else {
      const from = i
      while (i < rows.length && !visible[i]) i++
      const to = i - 1
      // 짧은 구간은 접어도 이득이 없으니 그냥 보여준다
      if (to - from + 1 <= 4) blocks.push({ kind: 'rows', from, to })
      // 펼쳐 둔 구간은 표시해 둔다 — 화면이 그 자리에 "다시 접기" 를 단다
      else if (expandedGaps.has(from)) blocks.push({ kind: 'rows', from, to, opened: true })
      else blocks.push({ kind: 'gap', from, to })
    }
  }
  return blocks
}

/* ------------------------------------------------------------------ */
/* 통계 & 유사도                                                        */
/* ------------------------------------------------------------------ */

function emptyStats(aLines: number, bLines: number): DiffStats {
  return {
    aLines,
    bLines,
    comparedA: 0,
    comparedB: 0,
    same: 0,
    modified: 0,
    added: 0,
    removed: 0,
    ignored: 0,
    changedLines: 0,
    charsA: 0,
    charsB: 0,
    commonChars: 0,
    lineSimilarity: 0,
    diceSimilarity: 0,
    charSimilarity: 0,
    changeRatio: 1,
  }
}

export function computeStats(rows: DiffRow[], aAll: string[], bAll: string[]): DiffStats {
  let same = 0
  let modified = 0
  let added = 0
  let removed = 0
  let ignored = 0
  let charsA = 0
  let charsB = 0
  let commonA = 0
  let commonB = 0

  for (const r of rows) {
    const a = r.aText ?? ''
    const b = r.bText ?? ''
    switch (r.kind) {
      case 'equal':
        same++
        charsA += a.length
        charsB += b.length
        commonA += a.length
        commonB += b.length
        break
      case 'modify':
        modified++
        charsA += a.length
        charsB += b.length
        commonA += r.commonA ?? 0
        commonB += r.commonB ?? 0
        break
      case 'add':
        added++
        charsB += b.length
        break
      case 'remove':
        removed++
        charsA += a.length
        break
      case 'ignored':
        ignored++
        break
    }
  }

  const comparedA = same + modified + removed
  const comparedB = same + modified + added
  const denomMax = Math.max(comparedA, comparedB)
  const denomSum = comparedA + comparedB
  const charDenom = charsA + charsB

  return {
    aLines: aAll.length,
    bLines: bAll.length,
    comparedA,
    comparedB,
    same,
    modified,
    added,
    removed,
    ignored,
    changedLines: modified + added + removed,
    charsA,
    charsB,
    commonChars: commonA + commonB,
    // 줄 갯수 대비 유사도 — 완전히 일치한 줄 / 더 긴 쪽의 줄 수
    lineSimilarity: denomMax === 0 ? 1 : same / denomMax,
    // Dice 계수 (양쪽 줄 수 평균 기준)
    diceSimilarity: denomSum === 0 ? 1 : (2 * same) / denomSum,
    // 수정된 줄 안의 부분 일치까지 반영한 문자 단위 유사도
    charSimilarity: charDenom === 0 ? 1 : (commonA + commonB) / charDenom,
    changeRatio: denomMax === 0 ? 0 : 1 - same / denomMax,
  }
}

/** 여러 파일의 통계를 합산해 전체 유사도를 구한다. */
export function aggregateStats(statsList: readonly DiffStats[]): DiffStats {
  const total = emptyStats(0, 0)
  let commonChars = 0
  for (const s of statsList) {
    total.aLines += s.aLines
    total.bLines += s.bLines
    total.comparedA += s.comparedA
    total.comparedB += s.comparedB
    total.same += s.same
    total.modified += s.modified
    total.added += s.added
    total.removed += s.removed
    total.ignored += s.ignored
    total.charsA += s.charsA
    total.charsB += s.charsB
    commonChars += s.commonChars
  }
  total.commonChars = commonChars
  total.changedLines = total.modified + total.added + total.removed
  const denomMax = Math.max(total.comparedA, total.comparedB)
  const denomSum = total.comparedA + total.comparedB
  const charDenom = total.charsA + total.charsB
  total.lineSimilarity = denomMax === 0 ? 1 : total.same / denomMax
  total.diceSimilarity = denomSum === 0 ? 1 : (2 * total.same) / denomSum
  total.charSimilarity = charDenom === 0 ? 1 : commonChars / charDenom
  total.changeRatio = denomMax === 0 ? 0 : 1 - total.same / denomMax
  return total
}
