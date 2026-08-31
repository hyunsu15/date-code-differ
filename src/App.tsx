import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { fetchComparison, fetchFileContent, fetchSnapshots } from './api/client.ts'
import CodeSearchBar from './features/diff/CodeSearchBar.tsx'
import DiffNav from './features/diff/DiffNav.tsx'
import DiffViewer from './features/diff/DiffViewer.tsx'
import FileList from './features/files/FileList.tsx'
import PackageSummary from './features/packages/PackageSummary.tsx'
import SnapshotPicker from './features/snapshots/SnapshotPicker.tsx'
import { EMPTY_SELECTION, normalizeSelection } from './features/snapshots/selection.ts'
import SettingsPanel from './features/settings/SettingsPanel.tsx'
import {
  ENV_CHOICES,
  envById,
  envColorClass,
  envPath,
  loadEnvPair,
  saveEnvPair,
  withEnv,
} from './features/settings/envFolder.ts'
import {
  describeSource,
  loadSourceSelection,
  presetById,
  saveSourceSelection,
  type SourceSelection,
} from './features/settings/sourceSettings.ts'
import SummaryCard from './features/summary/SummaryCard.tsx'
import { aggregateStats, buildFileDiff } from './lib/diffEngine.ts'
import { num } from './lib/format.ts'
import { DEFAULT_OPTIONS } from './lib/normalize.ts'
import { searchRows } from './lib/search.ts'
import type {
  CodeScope,
  ComparisonResponse,
  DiffOptions,
  FileContentResponse,
  SearchOptions,
  SearchResult,
  Side,
  Snapshot,
  SourceConfig,
  Theme,
  ViewMode,
} from './types.ts'

const EMPTY_SEARCH: SearchResult = { matches: [], byRow: new Map(), error: null, truncated: false }
const DEFAULT_SEARCH: SearchOptions = { query: '', caseSensitive: false, regex: false }

/** `변경만` 모드에서 변경 줄 위아래로 함께 보여줄 줄 수 */
const CONTEXT_CHOICES = [
  { v: 0, label: '0줄' },
  { v: 3, label: '3줄' },
  { v: 8, label: '8줄' },
  { v: 25, label: '25줄' },
] as const

/** 불러온 스냅샷 목록과 그 출처 */
interface LoadedSnapshots {
  /** 이 목록을 읽어온 위치 설정. null 이면 아직 아무것도 못 읽었다 */
  source: SourceConfig | null
  root: string
  items: Snapshot[]
}

const EMPTY_LOADED: LoadedSnapshots = { source: null, root: '', items: [] }

const readStored = (key: string, fallback: string): string =>
  localStorage.getItem(key) ?? fallback

/** 코드 글자 크기(px) — 줄 높이는 1.6배로 함께 움직인다 */
const FONT_MIN = 10
const FONT_MAX = 22
const FONT_DEFAULT = 12.5
const FONT_STEP = 0.5

function readFontSize(): number {
  const raw = Number(localStorage.getItem('cd-code-font'))
  if (!Number.isFinite(raw) || raw < FONT_MIN || raw > FONT_MAX) return FONT_DEFAULT
  return raw
}

export default function App() {
  /* ---------------- 외부 폴더 / 스냅샷 ---------------- */
  const [sourceSelection, setSourceSelection] = useState<SourceSelection>(loadSourceSelection)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /**
   * 환경 폴더(운영/테스트) — **좌우가 각각 고른다.** 목록은 change/config.ts 에서 온다.
   * 환경마다 배포 시점이 달라 같은 날짜가 양쪽에 다 있으리라는 보장이 없다.
   */
  const [envPair, setEnvPair] = useState(loadEnvPair)

  const base = sourceSelection.source
  const leftEnvPath = envPath(envPair.left)
  const rightEnvPath = envPath(envPair.right)
  /** 좌우가 같은 곳을 보는지 — 날짜 순서 규칙과 훑기 횟수가 여기서 갈린다 */
  const sameSource = leftEnvPath === rightEnvPath

  /**
   * 실제로 읽을 위치 — 프리셋의 루트에 고른 환경 폴더를 붙인 것.
   *
   * `useMemo` 로 **동일성을 붙잡아 둔다.** 아래 여러 곳이 이 값을 의존성으로 쓰기 때문에
   * 렌더마다 새 객체가 나오면 목록을 끝없이 다시 읽는다.
   * 같은 환경이면 **같은 객체**를 쓴다 — 그래야 "한 곳인지" 를 동일성으로 가릴 수 있다.
   */
  const leftSource = useMemo(() => withEnv(base, leftEnvPath), [base, leftEnvPath])
  const rightSource = useMemo(
    () => (sameSource ? leftSource : withEnv(base, rightEnvPath)),
    [sameSource, leftSource, base, rightEnvPath]
  )

  // 목록이 어느 위치에서 온 것인지 함께 들고 있어야, 위치를 바꾼 직후
  // 옛 목록으로 비교 요청이 나가는 것을 막을 수 있다.
  const [leftLoaded, setLeftLoaded] = useState<LoadedSnapshots>(EMPTY_LOADED)
  const [rightLoaded, setRightLoaded] = useState<LoadedSnapshots>(EMPTY_LOADED)
  const root = leftLoaded.root
  // 좌우는 (같은 곳일 때) "이후가 이전보다 최신" 규칙을 함께 지켜야 해서 한 상태로 묶는다
  const [selection, setSelection] = useState(EMPTY_SELECTION)
  const { left, right } = selection
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingSnapshots, setLoadingSnapshots] = useState(true)

  /* ---------------- 비교 결과 ---------------- */
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null)
  const [comparing, setComparing] = useState(false)

  /* ---------------- 선택 / 필터 ---------------- */
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // 요구사항: 기본은 "바뀐 파일만" 보여준다
  const [onlyChanged, setOnlyChanged] = useState(true)
  const fileSearchRef = useRef<HTMLInputElement | null>(null)

  /* ---------------- 선택 파일 본문 ---------------- */
  const [content, setContent] = useState<FileContentResponse | null>(null)
  const [contentError, setContentError] = useState<string | null>(null)

  /* ---------------- 보기 옵션 ---------------- */
  const [options, setOptions] = useState<DiffOptions>(DEFAULT_OPTIONS)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  // 요구사항: 기본은 변경된 부분만. 사용자가 원하면 전체 코드로 전환한다.
  const [codeScope, setCodeScope] = useState<CodeScope>(
    () => (readStored('cd-scope', 'changed') as CodeScope) ?? 'changed'
  )
  const [contextLines, setContextLines] = useState(3)
  const [wrap, setWrap] = useState(true)
  const [codeFontSize, setCodeFontSize] = useState<number>(readFontSize)
  const [syncScroll, setSyncScroll] = useState(() => readStored('cd-sync', 'on') !== 'off')
  const [theme, setTheme] = useState<Theme>(() => readStored('cd-theme', 'dark') as Theme)
  const [showSidebar, setShowSidebar] = useState(true)

  /* ---------------- diff 포인트 ---------------- */
  const [currentHunk, setCurrentHunk] = useState(0)
  const [scrollSeq, setScrollSeq] = useState(0)
  const hunkCountRef = useRef(0)

  /* ---------------- 코드 검색 ---------------- */
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchOpts, setSearchOpts] = useState<SearchOptions>(DEFAULT_SEARCH)
  const [matchIndex, setMatchIndex] = useState(0)

  /* ================================================================
     설정 저장
     ================================================================ */

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('cd-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('cd-sync', syncScroll ? 'on' : 'off')
  }, [syncScroll])

  useEffect(() => {
    localStorage.setItem('cd-scope', codeScope)
  }, [codeScope])

  // 코드 영역 글자 크기는 CSS 변수로 내려보낸다 (줄 높이도 같이 움직여야 행이 겹치지 않는다)
  useEffect(() => {
    const style = document.documentElement.style
    style.setProperty('--code-size', `${codeFontSize}px`)
    style.setProperty('--code-lh', `${Math.round(codeFontSize * 1.6)}px`)
    localStorage.setItem('cd-code-font', String(codeFontSize))
  }, [codeFontSize])

  /* ================================================================
     스냅샷 목록
     ================================================================ */

  const snapshotSeq = useRef(0)

  /**
   * 좌우 날짜 목록을 읽는다.
   * **같은 곳이면 한 번만** 물어본다 — 환경을 나누지 않고 쓰는 흔한 경우에서 요청이 늘지 않게.
   */
  const loadSnapshots = useCallback(
    async (
      leftConfig: SourceConfig,
      rightConfig: SourceConfig,
      refresh: boolean
    ): Promise<void> => {
      const seq = ++snapshotSeq.current
      setLoadingSnapshots(true)
      setLoadError(null)

      // 실패해도 출처는 남긴다 — 그래야 옛 위치의 경로·목록이 화면에 남지 않는다
      const readOne = async (
        config: SourceConfig
      ): Promise<{ loaded: LoadedSnapshots; error: string | null }> => {
        try {
          const res = await fetchSnapshots(config, refresh)
          return { loaded: { source: config, root: res.root, items: res.items }, error: null }
        } catch (e) {
          return { loaded: { source: config, root: '', items: [] }, error: (e as Error).message }
        }
      }

      const same = leftConfig === rightConfig
      const [leftRes, rightRes] = same
        ? await readOne(leftConfig).then((one) => [one, one] as const)
        : await Promise.all([readOne(leftConfig), readOne(rightConfig)])

      if (seq !== snapshotSeq.current) return // 환경을 빠르게 바꾼 경우 — 뒤늦은 응답은 버린다

      setLeftLoaded(leftRes.loaded)
      setRightLoaded(rightRes.loaded)
      // 고르고 있던 스냅샷이 남아 있으면 유지하고, 아니면 규칙에 맞게 맞춘다
      setSelection((prev) =>
        normalizeSelection(prev, leftRes.loaded.items, rightRes.loaded.items, same)
      )
      setComparison(null)

      // 한쪽만 실패할 수 있다. 어느 위치가 실패했는지 함께 보여야 고칠 곳을 안다
      const failures = [
        leftRes.error && (same ? leftRes.error : `${leftConfig.root}\n${leftRes.error}`),
        !same && rightRes.error ? `${rightConfig.root}\n${rightRes.error}` : null,
      ].filter((m): m is string => Boolean(m))
      setLoadError(failures.length > 0 ? failures.join('\n\n') : null)
      setLoadingSnapshots(false)
    },
    []
  )

  // 위치(프리셋·환경 폴더)가 바뀌면 목록을 통째로 다시 읽는다
  useEffect(() => {
    void loadSnapshots(leftSource, rightSource, false)
  }, [loadSnapshots, leftSource, rightSource])

  /* ================================================================
     좌우 비교 — 목록/통계는 서버가 만들어 준다 (본문은 안 받는다)
     ================================================================ */

  const comparisonSeq = useRef(0)

  useEffect(() => {
    // 목록이 아직 다른 위치의 것이면 기다린다 — 옛 날짜로 새 위치를 물어보게 된다
    if (leftLoaded.source !== leftSource || rightLoaded.source !== rightSource || !left || !right) {
      setComparison(null)
      return
    }
    const seq = ++comparisonSeq.current
    setComparing(true)
    void fetchComparison(leftSource, rightSource, left, right, options)
      .then((res) => {
        if (seq !== comparisonSeq.current) return // 뒤늦게 도착한 응답은 버린다
        setComparison(res)
      })
      .catch((e: Error) => {
        if (seq !== comparisonSeq.current) return
        setComparison(null)
        setLoadError(e.message)
      })
      .finally(() => {
        if (seq === comparisonSeq.current) setComparing(false)
      })
  }, [leftLoaded.source, rightLoaded.source, leftSource, rightSource, left, right, options])

  /* ================================================================
     목록 필터링 & 선택
     ================================================================ */

  const visibleFiles = useMemo(() => {
    const all = comparison?.files ?? []
    const q = query.trim().toLowerCase()
    return all.filter((f) => {
      if (selectedPackage && f.packageName !== selectedPackage) return false
      if (q && !f.path.toLowerCase().includes(q)) return false
      if (onlyChanged && f.status === 'same') return false
      return true
    })
  }, [comparison, query, onlyChanged, selectedPackage])

  const selectedFile = useMemo(
    () => visibleFiles.find((f) => f.path === selectedPath) ?? visibleFiles[0] ?? null,
    [visibleFiles, selectedPath]
  )

  // 필터 때문에 선택이 사라지면 목록의 첫 항목으로 옮겨 붙인다
  useEffect(() => {
    if (selectedFile && selectedFile.path !== selectedPath) setSelectedPath(selectedFile.path)
    if (!selectedFile && selectedPath !== null) setSelectedPath(null)
  }, [selectedFile, selectedPath])

  /* ================================================================
     선택 파일 본문 — 고른 파일 하나만 받아온다
     ================================================================ */

  const contentSeq = useRef(0)

  useEffect(() => {
    const path = selectedFile?.path
    if (!path || !left || !right) {
      setContent(null)
      return
    }
    // 날짜를 바꾼 직후에는 파일 목록이 아직 이전 좌우 조합의 것이다.
    // 그때 요청하면 새 조합에 없는 파일을 물어보게 되므로(404) 목록이 따라올 때까지 기다린다.
    if (comparison?.left !== left || comparison?.right !== right) return

    const seq = ++contentSeq.current
    setContentError(null)
    void fetchFileContent(leftSource, rightSource, left, right, path)
      .then((res) => {
        if (seq === contentSeq.current) setContent(res)
      })
      .catch((e: Error) => {
        if (seq !== contentSeq.current) return
        setContent(null)
        setContentError(e.message)
      })
  }, [
    leftSource,
    rightSource,
    selectedFile?.path,
    left,
    right,
    comparison?.left,
    comparison?.right,
  ])

  /* ================================================================
     화면에 그릴 diff
     ================================================================ */

  // 본문은 비동기로 오므로, 아직 이전 파일 것이면 그리지 않는다.
  // (새 파일 제목 아래 옛 코드가 잠깐 보이는 것을 막는다)
  const diff = useMemo(() => {
    if (!content || content.path !== selectedFile?.path) return null
    return buildFileDiff(content.leftText ?? '', content.rightText ?? '', options)
  }, [content, options, selectedFile?.path])

  const effectiveContext = codeScope === 'full' ? -1 : contextLines

  hunkCountRef.current = diff?.hunks.length ?? 0

  useEffect(() => {
    setCurrentHunk(0)
  }, [selectedFile?.path, options])

  /* ================================================================
     코드 내용 검색
     ================================================================ */

  const searchResult = useMemo(
    () => (searchOpen && diff ? searchRows(diff.rows, searchOpts) : EMPTY_SEARCH),
    [searchOpen, diff, searchOpts]
  )

  useEffect(() => {
    setMatchIndex(0)
  }, [searchOpts, selectedFile?.path])

  const activeMatch = searchResult.matches[matchIndex] ?? null

  const stepMatch = useCallback(
    (delta: number) => {
      const n = searchResult.matches.length
      if (n === 0) return
      setMatchIndex((prev) => (prev + delta + n) % n) // 끝에서 처음으로 순환
    },
    [searchResult.matches.length]
  )

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setMatchIndex(0)
  }, [])

  /* ================================================================
     네비게이션
     ================================================================ */

  const goHunk = useCallback((index: number, scroll: boolean): void => {
    const max = hunkCountRef.current - 1
    if (max < 0) return
    const next = Math.max(0, Math.min(max, index))
    setCurrentHunk((prev) => (prev === next ? prev : next))
    if (scroll) setScrollSeq((s) => s + 1)
  }, [])

  /** 상대 이동 — 연타/키 반복 시에도 누락되지 않도록 함수형 업데이트를 쓴다 */
  const stepHunk = useCallback((delta: number): void => {
    const max = hunkCountRef.current - 1
    if (max < 0) return
    setCurrentHunk((prev) => Math.max(0, Math.min(max, prev + delta)))
    setScrollSeq((s) => s + 1)
  }, [])

  const goFile = useCallback(
    (delta: number): void => {
      if (!visibleFiles.length) return
      const i = visibleFiles.findIndex((f) => f.path === selectedFile?.path)
      const next = visibleFiles[Math.max(0, Math.min(visibleFiles.length - 1, i + delta))]
      if (next) setSelectedPath(next.path)
    },
    [visibleFiles, selectedFile]
  )

  const applySource = useCallback((next: SourceSelection): void => {
    saveSourceSelection(next)
    setSourceSelection(next)
    setSettingsOpen(false)
  }, [])

  /**
   * 한쪽 환경을 바꾸면 그쪽 루트가 바뀌고, 그 위치로 목록을 다시 읽는다
   * (위 useEffect 가 위치를 보고 있다).
   */
  const changeEnv = useCallback((side: Side, id: string): void => {
    setEnvPair((prev) => {
      const next = side === 'left' ? { ...prev, left: id } : { ...prev, right: id }
      saveEnvPair(next)
      return next
    })
  }, [])

  const toggleSync = useCallback(() => setSyncScroll((v) => !v), [])
  const toggleScope = useCallback(
    () => setCodeScope((v) => (v === 'changed' ? 'full' : 'changed')),
    []
  )

  /**
   * 좌우 선택 변경.
   * `이전` 을 최신 쪽으로 옮겨 `이후` 가 더 이상 최신이 아니게 되면
   * normalizeSelection 이 `이후` 를 한 칸 더 최신으로 끌어올린다.
   */
  const changeSide = useCallback(
    (side: Side, id: string) => {
      setSelection((prev) =>
        normalizeSelection(
          side === 'left' ? { ...prev, left: id } : { ...prev, right: id },
          leftLoaded.items,
          rightLoaded.items,
          sameSource
        )
      )
    },
    [leftLoaded.items, rightLoaded.items, sameSource]
  )

  /* ---------------- 단축키 ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (!t) return
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable

      // 코드 검색은 입력 중에도 열 수 있어야 하므로 먼저 처리한다
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      if (e.key === 'F3') {
        e.preventDefault()
        setSearchOpen(true)
        stepMatch(e.shiftKey ? -1 : 1)
        return
      }
      if (e.key === 'Escape' && searchOpen) {
        e.preventDefault()
        closeSearch()
        return
      }

      // Alt 조합 — 입력 중에도 동작한다
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        toggleSync()
        return
      }
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        toggleScope()
        return
      }

      if (typing) return
      if (e.ctrlKey || e.metaKey) return

      let handled = true
      if (e.key === 'n' || e.key === 'j' || (e.altKey && e.key === 'ArrowDown')) stepHunk(1)
      else if (e.key === 'p' || e.key === 'k' || (e.altKey && e.key === 'ArrowUp')) stepHunk(-1)
      else if (e.key === ']') goFile(1)
      else if (e.key === '[') goFile(-1)
      else if (e.key === '/') fileSearchRef.current?.focus()
      else if (e.key === 'u') setViewMode((v) => (v === 'split' ? 'unified' : 'split'))
      else handled = false

      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepHunk, goFile, toggleSync, toggleScope, stepMatch, searchOpen, closeSearch])

  /* ================================================================
     렌더
     ================================================================ */

  const overall = useMemo(
    () => aggregateStats((comparison?.files ?? []).map((f) => f.stats)),
    [comparison]
  )
  const changedCount = useMemo(
    () => (comparison?.files ?? []).filter((f) => f.status !== 'same').length,
    [comparison]
  )
  /** 프리셋을 고른 상태면 그 이름을 헤더에 함께 보여준다 */
  const presetLabel = presetById(sourceSelection.presetId)?.label ?? null

  /** 좌우 목록이 둘 다 지금 위치의 것인지 — 아니면 아직 읽는 중이다 */
  const listsReady = leftLoaded.source === leftSource && rightLoaded.source === rightSource

  /**
   * 비교할 수 없는 상태.
   * 같은 곳이면 날짜가 두 개여야 하고(이후는 이전보다 최신이어야 하므로),
   * 다른 곳이면 각자 하나씩만 있으면 된다.
   */
  const tooFewSnapshots =
    !loadingSnapshots &&
    !loadError &&
    listsReady &&
    (sameSource
      ? leftLoaded.items.length < 2
      : leftLoaded.items.length === 0 || rightLoaded.items.length === 0)

  /** 날짜 폴더가 하나도 없는 환경들 — 어디를 고쳐야 하는지 알려주기 위한 것 */
  const emptyEnvs = [
    leftLoaded.items.length === 0 ? envById(envPair.left).label : null,
    !sameSource && rightLoaded.items.length === 0 ? envById(envPair.right).label : null,
  ].filter((label): label is string => Boolean(label))

  /**
   * diff 칸에 붙는 짧은 표시.
   * 같은 곳이면 `이전`/`이후` 지만, 환경이 갈리면 그 말이 틀린다 — 운영 9/1 을
   * 테스트 8/1 과 견주는 것은 정상이고 그때 왼쪽은 "이전" 이 아니다. 환경 이름을 쓴다.
   */
  const sideTag = (envId: string, fallback: string): string =>
    sameSource ? fallback : envById(envId).label || fallback
  const leftTag = sideTag(envPair.left, '이전')
  const rightTag = sideTag(envPair.right, '이후')

  /**
   * 색은 **글자가 가리키는 것**을 따른다.
   * 환경 이름이 쓰여 있으면 환경 색, `이전`/`이후` 면 좌/우 색(빨강·초록)이다.
   * 날짜 칸의 선택은 늘 환경 이름을 보여주므로 거기서는 항상 환경 색을 쓴다.
   */
  const sideTagClass = (envId: string): string => (sameSource ? '' : envColorClass(envId))
  const setOpt = (k: keyof DiffOptions) => (e: ChangeEvent<HTMLInputElement>) =>
    setOptions((o) => ({ ...o, [k]: e.target.checked }))

  return (
    <div className="app">
      {settingsOpen && (
        <SettingsPanel
          value={sourceSelection}
          onApply={applySource}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <header className="header">
        <div className="brand">
          <span className="dot">◧</span>
          <span>환경 · 날짜별 소스 Diff</span>
          <small
            title={[
              presetLabel,
              root || describeSource(leftSource),
              // 좌우가 다른 곳이면 헤더 한 줄에 다 넣을 수 없다 — 툴팁에는 둘 다 보여준다
              sameSource ? null : rightLoaded.root || describeSource(rightSource),
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <span className={`src-tag ${leftSource.mode}`}>
              {leftSource.mode === 'ssh' ? 'SSH' : '폴더'}
            </span>
            {presetLabel && <span className="preset-name">{presetLabel}</span>}
            {root || describeSource(leftSource)}
          </small>
        </div>

        <div className="header-spacer" />

        {/* 환경 선택은 좌우 칸 안에 있다 — 한쪽만 바꿔 운영↔테스트를 견줄 수 있어야 한다 */}
        <SnapshotPicker
          left={{
            envId: envPair.left,
            snapshots: leftLoaded.items,
            value: left,
            tagClass: envColorClass(envPair.left),
          }}
          right={{
            envId: envPair.right,
            snapshots: rightLoaded.items,
            value: right,
            tagClass: envColorClass(envPair.right),
          }}
          envChoices={ENV_CHOICES}
          sameSource={sameSource}
          onChangeSnapshot={changeSide}
          onChangeEnv={changeEnv}
          onRefresh={() => void loadSnapshots(leftSource, rightSource, true)}
          loading={loadingSnapshots}
        />

        <button
          type="button"
          className="btn sm"
          onClick={() => setSettingsOpen(true)}
          title="비교 대상 위치 설정 (로컬 폴더 / SSH 원격)"
        >
          ⚙ 위치
        </button>

        <button
          type="button"
          className="btn sm"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title="라이트/다크 전환"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      {loadError && (
        <div className="banner error">
          <b>불러오지 못했습니다.</b> {loadError}
        </div>
      )}
      {tooFewSnapshots && (
        <div className="banner warn">
          {emptyEnvs.length > 0
            ? `${emptyEnvs.join(' · ')} 안에 날짜 폴더가 없습니다.`
            : sameSource
              ? `날짜 폴더가 1개(${leftLoaded.items[0]?.id})뿐입니다. 같은 환경끼리 비교하려면 2개 이상 필요합니다.`
              : '비교할 날짜를 고를 수 없습니다.'}
          {/* 환경 폴더로 내려간 걸 잊고 "폴더가 없다" 만 보면 원인을 찾기 어렵다 */}
          {leftEnvPath &&
            sameSource &&
            ` 지금은 ${envById(envPair.left).label}(루트 아래 '${leftEnvPath}' 폴더) 안을 보고 있습니다.`}
          {/* 같은 환경에 날짜가 하나뿐이어도, 다른 환경과는 견줄 수 있다 */}
          {sameSource && ENV_CHOICES.length > 1 && leftLoaded.items.length === 1 && (
            <> 다른 환경을 고르면 그쪽과 견줄 수 있습니다.</>
          )}
        </div>
      )}

      {comparison && (
        <PackageSummary
          packages={comparison.packages}
          selected={selectedPackage}
          onSelect={setSelectedPackage}
        />
      )}

      <div className="optionbar">
        <div className="group">
          <span className="label">코드</span>
          <div className="btn-group">
            <button
              type="button"
              className={`btn sm ${codeScope === 'changed' ? 'active' : ''}`}
              onClick={() => setCodeScope('changed')}
              title="변경된 부분만 보여줍니다 (Alt+A 로 전환)"
            >
              변경만
            </button>
            <button
              type="button"
              className={`btn sm ${codeScope === 'full' ? 'active' : ''}`}
              onClick={() => setCodeScope('full')}
              title="파일 전체를 diff 색과 함께 보여줍니다 (Alt+A 로 전환)"
            >
              전체
            </button>
          </div>
        </div>

        <div className="divider" />

        <div className="group" style={{ opacity: codeScope === 'changed' ? 1 : 0.45 }}>
          <span className="label">문맥</span>
          <div className="btn-group">
            {CONTEXT_CHOICES.map((c) => (
              <button
                key={c.v}
                type="button"
                className={`btn sm ${contextLines === c.v ? 'active' : ''}`}
                onClick={() => setContextLines(c.v)}
                disabled={codeScope === 'full'}
                title={codeScope === 'full' ? '전체 보기에서는 문맥 설정이 필요 없습니다' : ''}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divider" />

        <div className="group">
          <span className="label">보기</span>
          <div className="btn-group">
            <button
              type="button"
              className={`btn sm ${viewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
            >
              나란히
            </button>
            <button
              type="button"
              className={`btn sm ${viewMode === 'unified' ? 'active' : ''}`}
              onClick={() => setViewMode('unified')}
            >
              통합
            </button>
          </div>
        </div>

        <div className="divider" />

        <div className="group">
          <span className="label">무시</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={options.ignoreWhitespace}
              onChange={setOpt('ignoreWhitespace')}
            />
            공백
          </label>
          <label className="toggle">
            <input type="checkbox" checked={options.ignoreCase} onChange={setOpt('ignoreCase')} />
            대소문자
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={options.ignoreBlankLines}
              onChange={setOpt('ignoreBlankLines')}
            />
            빈 줄
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={options.ignoreComments}
              onChange={setOpt('ignoreComments')}
            />
            주석
          </label>
        </div>

        <div className="divider" />

        <label className="toggle">
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
          줄바꿈
        </label>

        <div className="divider" />

        <div className="group">
          <span className="label">글자</span>
          <div className="btn-group">
            <button
              type="button"
              className="btn sm"
              onClick={() => setCodeFontSize((v) => Math.max(FONT_MIN, v - FONT_STEP))}
              disabled={codeFontSize <= FONT_MIN}
              title="코드 글자 작게"
              aria-label="코드 글자 작게"
            >
              가−
            </button>
            <button
              type="button"
              className="btn sm font-size"
              onClick={() => setCodeFontSize(FONT_DEFAULT)}
              disabled={codeFontSize === FONT_DEFAULT}
              title="기본 크기로 되돌리기"
            >
              {codeFontSize}px
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => setCodeFontSize((v) => Math.min(FONT_MAX, v + FONT_STEP))}
              disabled={codeFontSize >= FONT_MAX}
              title="코드 글자 크게"
              aria-label="코드 글자 크게"
            >
              가+
            </button>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <button type="button" className="btn sm" onClick={() => setShowSidebar((v) => !v)}>
          {showSidebar ? '◧ 목록 숨기기' : '▣ 목록 보기'}
        </button>
      </div>

      <div className={`main ${showSidebar ? '' : 'no-sidebar'}`}>
        {showSidebar && (
          <aside className="sidebar">
            {/* 비교한 파일이 없을 때 유사도 100% 는 오해를 부르므로 카드를 띄우지 않는다 */}
            {comparison && comparison.files.length > 0 ? (
              <SummaryCard
                stats={overall}
                fileCount={comparison.files.length}
                changedCount={changedCount}
                leftLabel={`${leftTag} ${left}`}
                rightLabel={`${rightTag} ${right}`}
                loading={comparing}
              />
            ) : (
              <div className="summary-empty">
                {comparing ? '비교하는 중…' : '비교할 파일이 없습니다.'}
              </div>
            )}

            <div className="filter">
              <input
                ref={fileSearchRef}
                className="search"
                type="search"
                placeholder="파일 경로 검색 ( / )"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={onlyChanged}
                  onChange={(e) => setOnlyChanged(e.target.checked)}
                />
                변경된 파일만
              </label>
            </div>

            <div className="filelist-head">
              파일 <b>{num(visibleFiles.length)}</b>개
              {selectedPackage && <span className="pkg-filter">· {selectedPackage}</span>}
              {comparison && comparison.skipped > 0 && (
                <span className="skipped" title="change/config.ts 의 SCAN 기준">
                  · 제외 {comparison.skipped}
                </span>
              )}
            </div>

            <FileList
              files={visibleFiles}
              selectedPath={selectedFile?.path ?? null}
              onSelect={setSelectedPath}
              emptyMessage={
                comparing
                  ? '비교하는 중…'
                  : onlyChanged
                    ? '변경된 파일이 없습니다. "변경된 파일만" 을 끄면 전체가 보입니다.'
                    : '비교할 파일이 없습니다.'
              }
            />
          </aside>
        )}

        <section className="viewer">
          {selectedFile && diff ? (
            <>
              <DiffNav
                hunks={diff.hunks}
                diffEnabled
                current={currentHunk}
                onGo={goHunk}
                onStep={stepHunk}
                onPrevFile={() => goFile(-1)}
                onNextFile={() => goFile(1)}
                onOpenSearch={() => setSearchOpen(true)}
                fileKey={selectedFile.path}
              />

              {searchOpen && (
                <CodeSearchBar
                  options={searchOpts}
                  onChange={setSearchOpts}
                  result={searchResult}
                  index={matchIndex}
                  onStep={stepMatch}
                  onClose={closeSearch}
                />
              )}

              <div className="file-title">
                <b>{selectedFile.path}</b>
              </div>

              <DiffViewer
                diff={diff}
                fileKey={selectedFile.path}
                fileName={selectedFile.name}
                leftText={content?.leftText ?? null}
                rightText={content?.rightText ?? null}
                leftLabel={left}
                rightLabel={right}
                leftTag={leftTag}
                rightTag={rightTag}
                leftTagClass={sideTagClass(envPair.left)}
                rightTagClass={sideTagClass(envPair.right)}
                viewMode={viewMode}
                context={effectiveContext}
                wrap={wrap}
                syncScroll={syncScroll}
                onToggleSync={toggleSync}
                currentHunk={currentHunk}
                scrollSeq={scrollSeq}
                onCurrentHunkChange={goHunk}
                searchByRow={searchResult.byRow}
                activeMatch={activeMatch}
              />
            </>
          ) : selectedFile ? (
            <>
              <div className="file-title">
                <b>{selectedFile.path}</b>
                {!contentError && <span className="loading">불러오는 중…</span>}
              </div>
              <div className="empty">
                {contentError ? (
                  <>
                    <h2>파일을 읽지 못했습니다</h2>
                    <p className="error-detail">{contentError}</p>
                  </>
                ) : (
                  <h2>파일을 읽는 중입니다</h2>
                )}
              </div>
            </>
          ) : (
            <div className="empty">
              <h2>{comparing ? '비교하는 중…' : '비교할 파일을 고르세요'}</h2>
              <p>
                위에서 좌우의 환경·날짜를 고르면 바뀐 패키지와 파일이 표시됩니다.
                <br />
                왼쪽 목록에서 파일을 누르면 diff 가 열립니다.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
