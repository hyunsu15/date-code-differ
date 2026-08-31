import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { buildBlocks } from '../../lib/diffEngine.ts'
import { detectLanguage, highlightByLine, mergeSegments } from '../../lib/highlight.ts'
import type {
  CharRange,
  CodeMatch,
  DiffRow,
  FileDiff,
  LineSegments,
  RenderBlock,
  RowMatches,
  Segment,
  ViewMode,
} from '../../types.ts'

type ClassValue = string | false | null | undefined
const cx = (...v: ClassValue[]): string => v.filter(Boolean).join(' ')

function tokenClass(type: string | null): string | null {
  if (!type) return null
  return type
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `tok-${t}`)
    .join(' ')
}

/* ------------------------------------------------------------------ */

interface CodeCellProps {
  text: string | null
  segs: Segment[] | null | undefined
  ranges: CharRange[] | null
  /** 코드 검색 결과 구간 */
  matches?: CharRange[] | null
  /** 그중 현재 선택된 구간 */
  active?: CharRange | null
  mark: string
  side: 'a' | 'b'
}

const CodeCell = memo(function CodeCell({
  text,
  segs,
  ranges,
  matches,
  active,
  mark,
  side,
}: CodeCellProps) {
  if (text == null) return <div className="cell r-empty" />
  const pieces = mergeSegments(text, segs, ranges, matches, active)
  const wordCls = side === 'a' ? 'w-del' : 'w-add'
  return (
    <div className="cell">
      <span className="mark">{mark}</span>
      <span className="src">
        {pieces.length === 0
          ? ' '
          : pieces.map((p, i) => {
              const cls = cx(
                tokenClass(p.type),
                p.changed && wordCls,
                p.match && (p.active ? 's-active' : 's-match')
              )
              return cls ? (
                <span key={i} className={cls}>
                  {p.text}
                </span>
              ) : (
                p.text
              )
            })}
      </span>
    </div>
  )
})

const MARK: Record<DiffRow['kind'], string> = {
  add: '+',
  remove: '−',
  modify: '~',
  equal: ' ',
  ignored: ' ',
}

/** 색·마커 없이 그냥 보여주는 행인지 */
const isFlat = (kind: DiffRow['kind']): boolean => kind === 'equal' || kind === 'ignored'

/* ------------------------------------------------------------------ */
/* 나란히 보기 — 한쪽 패널의 한 행                                       */
/* ------------------------------------------------------------------ */

interface PaneRowProps {
  row: DiffRow
  side: 'a' | 'b'
  aSegs: LineSegments | null
  bSegs: LineSegments | null
  rowMatches: RowMatches | undefined
  activeMatch: CodeMatch | null
  focused: boolean
  hunkStart: number | undefined
}

const PaneRow = memo(function PaneRow({
  row,
  side,
  aSegs,
  bSegs,
  rowMatches,
  activeMatch,
  focused,
  hunkStart,
}: PaneRowProps) {
  const flat = isFlat(row.kind)
  const isA = side === 'a'

  const text = isA ? row.aText : row.bText
  const other = isA ? row.bText : row.aText
  const no = isA ? row.aNo : row.bNo
  const segs = isA ? (row.aNo ? aSegs?.[row.aNo - 1] : null) : row.bNo ? bSegs?.[row.bNo - 1] : null
  const otherSegs = isA
    ? row.bNo
      ? bSegs?.[row.bNo - 1]
      : null
    : row.aNo
      ? aSegs?.[row.aNo - 1]
      : null
  const ranges = isA ? row.aRanges : row.bRanges
  const otherRanges = isA ? row.bRanges : row.aRanges
  const matches = isA ? rowMatches?.a : rowMatches?.b
  const otherMatches = isA ? rowMatches?.b : rowMatches?.a
  const activeFor = (s: 'a' | 'b'): CharRange | null =>
    activeMatch && activeMatch.row === row.id && activeMatch.side === s
      ? [activeMatch.start, activeMatch.end]
      : null

  const kind = text == null ? 'r-empty' : flat ? '' : isA ? 'r-del' : 'r-add'

  // 좌우가 독립 스크롤이라 행 높이가 어긋나면 두 패널이 바로 틀어진다.
  // 반대편 줄을 보이지 않게 같은 칸에 겹쳐 행 높이를 max(양쪽)으로 맞춘다.
  // 글자 수로 높이를 추측해 건너뛰면 안 된다 —
  //  · 줄바꿈 ON: 단어 단위로 접히므로 짧은 줄이 더 높을 수 있다
  //  · 줄바꿈 OFF: 넘치는 셀에만 가로 스크롤바가 생겨 그만큼 높아진다
  // 내용이 완전히 같을 때만 안전하게 건너뛴다 (대부분의 equal 행이 여기 해당).
  const needGhost = other != null && other !== text

  return (
    <div
      className={cx(
        'diff-row',
        'pane-row',
        focused && 'focused',
        row.kind === 'ignored' && 'r-ignored'
      )}
      data-hunk-start={hunkStart}
      data-row={row.id}
    >
      <div className={cx('ln', kind)}>{no ?? ''}</div>
      <div className={cx('stack', kind)}>
        <CodeCell
          text={text}
          segs={segs}
          ranges={ranges}
          matches={matches}
          active={activeFor(side)}
          mark={text == null ? '' : flat ? ' ' : MARK[row.kind]}
          side={side}
        />
        {needGhost && (
          // 반대편과 완전히 같은 마크업이어야 높이가 정확히 맞으므로 검색 구간까지 그대로 넘긴다
          <div className="ghost" aria-hidden="true">
            <CodeCell
              text={other}
              segs={otherSegs}
              ranges={otherRanges}
              matches={otherMatches}
              active={activeFor(isA ? 'b' : 'a')}
              mark=" "
              side={isA ? 'b' : 'a'}
            />
          </div>
        )}
      </div>
    </div>
  )
})

/* ------------------------------------------------------------------ */
/* 통합 보기 — modify 는 삭제행 + 추가행 두 줄로 펼친다                   */
/* ------------------------------------------------------------------ */

interface UnifiedRowProps {
  row: DiffRow
  aSegs: LineSegments | null
  bSegs: LineSegments | null
  rowMatches: RowMatches | undefined
  activeMatch: CodeMatch | null
  focused: boolean
  hunkStart: number | undefined
}

const UnifiedRows = memo(function UnifiedRows({
  row,
  aSegs,
  bSegs,
  rowMatches,
  activeMatch,
  focused,
  hunkStart,
}: UnifiedRowProps) {
  const out: ReactNode[] = []
  const activeFor = (s: 'a' | 'b'): CharRange | null =>
    activeMatch && activeMatch.row === row.id && activeMatch.side === s
      ? [activeMatch.start, activeMatch.end]
      : null

  const push = (
    key: string,
    cls: string,
    aNo: number | null,
    bNo: number | null,
    text: string | null,
    segs: Segment[] | null | undefined,
    ranges: CharRange[] | null,
    mark: string,
    side: 'a' | 'b',
    anchor: number | undefined
  ): void => {
    out.push(
      <div
        key={key}
        className={cx('diff-row', 'unified', focused && 'focused')}
        data-hunk-start={anchor}
        data-row={row.id}
      >
        <div className={cx('ln', cls)}>{aNo ?? ''}</div>
        <div className={cx('ln', cls)}>{bNo ?? ''}</div>
        <div className={cls}>
          <CodeCell
            text={text}
            segs={segs}
            ranges={ranges}
            matches={side === 'a' ? rowMatches?.a : rowMatches?.b}
            active={activeFor(side)}
            mark={mark}
            side={side}
          />
        </div>
      </div>
    )
  }

  if (row.kind === 'equal' || row.kind === 'ignored') {
    push(
      'e',
      row.kind === 'ignored' ? 'r-ignored' : '',
      row.aNo,
      row.bNo,
      row.aText,
      row.aNo ? aSegs?.[row.aNo - 1] : null,
      null,
      ' ',
      'a',
      hunkStart
    )
  } else {
    if (row.aText != null) {
      push('d', 'r-del', row.aNo, null, row.aText, row.aNo ? aSegs?.[row.aNo - 1] : null, row.aRanges, '−', 'a', hunkStart)
    }
    if (row.bText != null) {
      push(
        'a',
        'r-add',
        null,
        row.bNo,
        row.bText,
        row.bNo ? bSegs?.[row.bNo - 1] : null,
        row.bRanges,
        '+',
        'b',
        row.aText == null ? hunkStart : undefined
      )
    }
  }
  return <>{out}</>
})

/* ------------------------------------------------------------------ */

interface DiffViewerProps {
  diff: FileDiff
  /** 선택된 파일의 상대 경로 — 바뀌면 접기·스크롤 상태를 초기화한다 */
  fileKey: string
  /** 문법 하이라이트 언어 판별용 파일명 */
  fileName: string
  /** 왼쪽(이전 스냅샷) 본문. 그쪽에 없는 파일이면 null */
  leftText: string | null
  /** 오른쪽(이후 스냅샷) 본문. 그쪽에 없는 파일이면 null */
  rightText: string | null
  /** 패널 머리에 표시할 스냅샷 이름 */
  /** 왼쪽 칸 이름 (스냅샷 id) */
  leftLabel: string
  rightLabel: string
  /**
   * 칸 앞에 붙는 짧은 표시.
   * 좌우가 같은 곳이면 `이전`/`이후`, 환경이 갈리면 그 환경 이름이 온다 —
   * 운영 9/1 을 테스트 8/1 과 견줄 때 왼쪽을 "이전" 이라 부르면 거짓말이 된다.
   */
  leftTag: string
  rightTag: string
  /**
   * 그 표시에 입힐 색 클래스.
   * 환경 이름을 보여줄 때만 환경 색이 온다 — `이전`/`이후` 라고 쓰여 있으면
   * 빈 문자열이고, 그때는 예전처럼 좌/우 색(빨강·초록)을 쓴다.
   * **글자와 색이 항상 같은 것을 가리키게** 하기 위한 규칙이다.
   */
  leftTagClass: string
  rightTagClass: string
  viewMode: ViewMode
  context: number
  wrap: boolean
  syncScroll: boolean
  onToggleSync: () => void
  currentHunk: number
  scrollSeq: number
  onCurrentHunkChange: (index: number, scroll: boolean) => void
  /** 코드 검색 결과 — 행 인덱스별 하이라이트 구간 */
  searchByRow: Map<number, RowMatches>
  /** 현재 선택된 검색 결과 */
  activeMatch: CodeMatch | null
}

export default function DiffViewer({
  diff,
  fileKey,
  fileName,
  leftText,
  rightText,
  leftLabel,
  rightLabel,
  leftTag,
  rightTag,
  leftTagClass,
  rightTagClass,
  viewMode,
  context,
  wrap,
  syncScroll,
  onToggleSync,
  currentHunk,
  scrollSeq,
  onCurrentHunkChange,
  searchByRow,
  activeMatch,
}: DiffViewerProps) {
  const paneA = useRef<HTMLDivElement | null>(null)
  const paneB = useRef<HTMLDivElement | null>(null)
  const unifiedRef = useRef<HTMLDivElement | null>(null)
  /** 동기 스크롤을 켤 때의 두 패널 스크롤 차이 (px). 상대 위치를 유지한다 */
  const syncOffsetRef = useRef(0)
  const suppressObserver = useRef(0)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())

  const { rows, hunks } = diff
  const split = viewMode === 'split'

  // 파일/옵션이 바뀌면 접기 상태와 스크롤 위치를 초기화
  useEffect(() => {
    setExpanded(new Set())
    syncOffsetRef.current = 0
    for (const el of [paneA.current, paneB.current, unifiedRef.current]) {
      if (el) el.scrollTop = 0
    }
  }, [fileKey, context, viewMode])

  const aText = leftText ?? ''
  const bText = rightText ?? ''
  // 같은 파일의 좌우는 확장자가 같으므로 언어도 하나로 판별한다
  const lang = useMemo(() => detectLanguage(fileName), [fileName])

  const aSegs = useMemo(
    () => highlightByLine(aText, lang, `${fileKey}:left`),
    [aText, lang, fileKey]
  )
  const bSegs = useMemo(
    () => highlightByLine(bText, lang, `${fileKey}:right`),
    [bText, lang, fileKey]
  )

  const blocks = useMemo(() => buildBlocks(rows, context, expanded), [rows, context, expanded])

  // 행 index → hunk index, hunk 시작 행 표시용
  const { hunkOfRow, hunkStartAt } = useMemo(() => {
    const of = new Map<number, number>()
    const startAt = new Map<number, number>()
    hunks.forEach((h) => {
      startAt.set(h.rowStart, h.index)
      for (let i = h.rowStart; i <= h.rowEnd; i++) of.set(i, h.index)
    })
    return { hunkOfRow: of, hunkStartAt: startAt }
  }, [hunks])

  /* ---------------- 스크롤 동기화 ---------------- */

  // scroll 은 React 이벤트 위임에 맡기지 않고 각 패널에 직접 건다.
  // 켜는 순간의 두 패널 간격을 기억해 상대 위치를 유지하고,
  // 한 줄 이내로 가까우면 딱 맞춘다.
  useEffect(() => {
    if (!split || !syncScroll) return
    const a = paneA.current
    const b = paneB.current
    if (!a || !b) return

    const gap = b.scrollTop - a.scrollTop
    syncOffsetRef.current = Math.abs(gap) < 20 ? 0 : gap

    // 되먹임은 타이머 래치 없이 "수렴 검사"로 막는다.
    // dst 를 옮기면 dst 핸들러가 다시 불리지만, 그때는 src 가 이미 원하는 위치라
    // 아래 조기 반환에 걸려 한 번에 멈춘다. rAF/타이머에 기대지 않으므로
    // 탭이 백그라운드로 가서 프레임이 지연돼도 동기화가 죽지 않는다.
    const mirror = (src: HTMLDivElement, dst: HTMLDivElement, sign: 1 | -1) => (): void => {
      const want = src.scrollTop + sign * syncOffsetRef.current
      if (Math.abs(dst.scrollTop - want) < 1) return
      dst.scrollTop = want
    }

    const onA = mirror(a, b, 1)
    const onB = mirror(b, a, -1)
    a.addEventListener('scroll', onA, { passive: true })
    b.addEventListener('scroll', onB, { passive: true })
    return () => {
      a.removeEventListener('scroll', onA)
      b.removeEventListener('scroll', onB)
    }
  }, [split, syncScroll, fileKey, viewMode])

  /* ---------------- diff 포인트 이동 ---------------- */

  // 네비게이션은 "같은 줄을 양쪽에서 보여주는" 의미이므로 간격을 0으로 리셋한다
  useLayoutEffect(() => {
    if (scrollSeq === 0 || currentHunk < 0) return
    const selector = `[data-hunk-start="${currentHunk}"]`
    suppressObserver.current = Date.now() + 800

    if (!split) {
      unifiedRef.current?.querySelector(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }

    syncOffsetRef.current = 0
    paneA.current?.querySelector(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // 동기 스크롤이 켜져 있으면 A 를 따라 B 가 자동으로 움직인다
    if (!syncScroll) {
      paneB.current?.querySelector(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [scrollSeq, currentHunk, split, syncScroll])

  /* ---------------- 검색 결과로 이동 ---------------- */

  const lastScrolled = useRef<CodeMatch | null>(null)

  useEffect(() => {
    if (!activeMatch) {
      lastScrolled.current = null
      return
    }
    // 접힌 구간 안에 있으면 먼저 펼친다 — 펼쳐지면 blocks 가 바뀌어 이 효과가 다시 돈다
    const gap = blocks.find(
      (b) => b.kind === 'gap' && activeMatch.row >= b.from && activeMatch.row <= b.to
    )
    if (gap) {
      setExpanded((prev) => {
        const next = new Set(prev)
        next.add(gap.from)
        return next
      })
      return
    }
    if (lastScrolled.current === activeMatch) return
    lastScrolled.current = activeMatch

    const root = split ? (activeMatch.side === 'a' ? paneA.current : paneB.current) : unifiedRef.current
    const el = root?.querySelector(`[data-row="${activeMatch.row}"]`)
    if (!el) return
    suppressObserver.current = Date.now() + 800
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeMatch, blocks, split])

  // 스크롤에 따라 현재 diff 포인트 자동 추적 (기준은 왼쪽 패널 / 통합 뷰)
  useEffect(() => {
    const root = split ? paneA.current : unifiedRef.current
    if (!root || !hunks.length) return
    const anchors = root.querySelectorAll<HTMLElement>('[data-hunk-start]')
    if (!anchors.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < suppressObserver.current) return
        const visible = entries
          .filter((e) => e.isIntersecting)
          .map((e) => Number((e.target as HTMLElement).dataset.hunkStart))
          .filter((n) => !Number.isNaN(n))
        if (!visible.length) return
        onCurrentHunkChange(Math.min(...visible), false)
      },
      { root, rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    )
    anchors.forEach((a) => observer.observe(a))
    return () => observer.disconnect()
  }, [blocks, hunks, split, onCurrentHunkChange])

  const expandGap = useCallback(
    (from: number): void =>
      setExpanded((prev) => {
        const next = new Set(prev)
        next.add(from)
        return next
      }),
    []
  )

  if (diff.tooLarge) {
    return (
      <div className="empty">
        <h2>파일이 너무 큽니다</h2>
        <p>양쪽 합쳐 60,000줄을 넘는 파일은 비교하지 않습니다.</p>
      </div>
    )
  }

  const wrapCls = wrap ? 'wrap-on' : 'wrap-off'

  if (!split) {
    return (
      <div className={cx('diff-scroll', wrapCls)} ref={unifiedRef}>
        <div className="diff-body">
          {blocks.map((block) =>
            block.kind === 'gap' ? (
              <GapButton key={`g${block.from}`} block={block} onExpand={expandGap} />
            ) : (
              renderUnified(block, rows, {
                aSegs,
                bSegs,
                currentHunk,
                hunkOfRow,
                hunkStartAt,
                searchByRow,
                activeMatch,
              })
            )
          )}
          {rows.length === 0 && (
            <div className="only-notice">비교할 내용이 없습니다. (두 파일 모두 비어 있음)</div>
          )}
        </div>
      </div>
    )
  }

  const paneProps = {
    rows,
    blocks,
    aSegs,
    bSegs,
    currentHunk,
    hunkOfRow,
    hunkStartAt,
    onExpand: expandGap,
    searchByRow,
    activeMatch,
  }

  return (
    <div className="split-panes">
      <div className={cx('pane', wrapCls)} ref={paneA} data-side="left">
        <div className="pane-head left">
          <span className={`side-tag ${leftTagClass}`}>{leftTag}</span>
          {leftLabel}
          {leftText == null && <span className="pane-missing">이 스냅샷에 없음</span>}
        </div>
        <Pane side="a" {...paneProps} />
      </div>

      <div className={cx('pane', wrapCls)} ref={paneB} data-side="right">
        <div className="pane-head right">
          <span className={`side-tag ${rightTagClass}`}>{rightTag}</span>
          {rightLabel}
          {rightText == null && <span className="pane-missing">이 스냅샷에 없음</span>}
        </div>
        <Pane side="b" {...paneProps} />
      </div>

      {/* 동기 스크롤 토글 — 두 패널 사이 정중앙에 항상 떠 있는 체인 버튼. 단축키 Alt+S. */}
      <button
        type="button"
        className={cx('sync-toggle', syncScroll && 'on')}
        aria-pressed={syncScroll}
        aria-label={syncScroll ? '동기 스크롤 끄기 (Alt+S)' : '동기 스크롤 켜기 (Alt+S)'}
        title={
          syncScroll
            ? '동기 스크롤 켜짐 · 클릭 또는 Alt+S 로 끄면 좌우를 따로 스크롤합니다'
            : '별도 스크롤 · 클릭 또는 Alt+S 로 켜면 좌우가 함께 움직입니다'
        }
        onClick={onToggleSync}
      >
        🔗
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */

interface GapButtonProps {
  block: RenderBlock
  onExpand: (from: number) => void
}

function GapButton({ block, onExpand }: GapButtonProps) {
  return (
    <button className="gap" onClick={() => onExpand(block.from)}>
      <span>⋯</span>
      <span>동일한 {block.to - block.from + 1}줄 접힘 — 클릭하면 펼칩니다</span>
    </button>
  )
}

interface PaneProps {
  side: 'a' | 'b'
  rows: DiffRow[]
  blocks: RenderBlock[]
  aSegs: LineSegments | null
  bSegs: LineSegments | null
  currentHunk: number
  hunkOfRow: Map<number, number>
  hunkStartAt: Map<number, number>
  onExpand: (from: number) => void
  searchByRow: Map<number, RowMatches>
  activeMatch: CodeMatch | null
}

function Pane({
  side,
  rows,
  blocks,
  aSegs,
  bSegs,
  currentHunk,
  hunkOfRow,
  hunkStartAt,
  onExpand,
  searchByRow,
  activeMatch,
}: PaneProps) {
  return (
    <div className="diff-body">
      {blocks.map((block) => {
        if (block.kind === 'gap') {
          return <GapButton key={`g${block.from}`} block={block} onExpand={onExpand} />
        }
        const out: ReactNode[] = []
        for (let i = block.from; i <= block.to; i++) {
          const row = rows[i]
          if (!row) continue
          out.push(
            <PaneRow
              key={i}
              row={row}
              side={side}
              aSegs={aSegs}
              bSegs={bSegs}
              rowMatches={searchByRow.get(i)}
              activeMatch={activeMatch}
              focused={hunkOfRow.get(i) === currentHunk}
              hunkStart={hunkStartAt.get(i)}
            />
          )
        }
        return out
      })}
      {rows.length === 0 && <div className="only-notice">비교할 내용이 없습니다.</div>}
    </div>
  )
}

interface UnifiedContext {
  aSegs: LineSegments | null
  bSegs: LineSegments | null
  currentHunk: number
  hunkOfRow: Map<number, number>
  hunkStartAt: Map<number, number>
  searchByRow: Map<number, RowMatches>
  activeMatch: CodeMatch | null
}

function renderUnified(block: RenderBlock, rows: DiffRow[], ctx: UnifiedContext): ReactNode[] {
  const out: ReactNode[] = []
  for (let i = block.from; i <= block.to; i++) {
    const row = rows[i]
    if (!row) continue
    out.push(
      <UnifiedRows
        key={i}
        row={row}
        aSegs={ctx.aSegs}
        bSegs={ctx.bSegs}
        rowMatches={ctx.searchByRow.get(i)}
        activeMatch={ctx.activeMatch}
        focused={ctx.hunkOfRow.get(i) === ctx.currentHunk}
        hunkStart={ctx.hunkStartAt.get(i)}
      />
    )
  }
  return out
}
