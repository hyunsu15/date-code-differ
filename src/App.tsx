import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchComparison,
  fetchFileContent,
  fetchSchemaChanges,
  fetchSchemaSnapshots,
  fetchSnapshotChanges,
  fetchSnapshots,
} from './api/client.ts'
import CodeSearchBar from './features/diff/CodeSearchBar.tsx'
import DiffNav from './features/diff/DiffNav.tsx'
import DiffViewer from './features/diff/DiffViewer.tsx'
import AllSameNotice from './features/files/AllSameNotice.tsx'
import FileList from './features/files/FileList.tsx'
import PackageSummary from './features/packages/PackageSummary.tsx'
import ReportButton, { type ReportOption } from './features/report/ReportButton.tsx'
import { loadReportKind, primaryKind, saveReportKind } from './features/report/reportPreference.ts'
import {
  buildReport,
  reportFileName,
  type ReportInput,
  type ReportKind,
} from './features/report/report.ts'
import { loadSchemaForReport } from './features/report/schemaForReport.ts'
import SchemaPane from './features/schema/SchemaPane.tsx'
import SnapshotPicker from './features/snapshots/SnapshotPicker.tsx'
import Toasts from './features/toast/Toasts.tsx'
import {
  AUTO_INTENT,
  EMPTY_SELECTION,
  lastWeekRange,
  normalizeSelection,
  selectionFromIntent,
  type DateIntent,
} from './features/snapshots/selection.ts'
import { changeHistory } from './features/snapshots/dateList.ts'
import HelpPanel from './features/help/HelpPanel.tsx'
import SettingsPanel, { type SettingsResult } from './features/settings/SettingsPanel.tsx'
import {
  applyLocalExclude,
  loadLocalExclude,
  parseLocalExclude,
  saveLocalExclude,
  toggleLocalExclude,
} from './features/settings/localExclude.ts'
import {
  loadMySchemaExclude,
  saveMySchemaExclude,
} from './features/schema/schemaExclude.ts'
import { matchSchemaDate } from './features/schema/schemaView.ts'
import { readFontSize } from './features/settings/FontSize.tsx'
import ViewOptions from './features/settings/ViewOptions.tsx'
import { loadDiffOptions, saveDiffOptions } from './features/settings/diffOptions.ts'
import {
  ENV_CHOICES,
  envById,
  envColorClass,
  envPath,
  linkEnvPair,
  loadEnvLinked,
  loadEnvPair,
  pickEnv,
  saveEnvLinked,
  saveEnvPair,
  withEnv,
} from './features/settings/envFolder.ts'
import {
  describeSource,
  loadSourceSelection,
  presetById,
  sameSelection,
  saveSourceSelection,
  shortSource,
  type SourceSelection,
} from './features/settings/sourceSettings.ts'
import SummaryCard from './features/summary/SummaryCard.tsx'
import { shownItems, splitSame } from './lib/changedFirst.ts'
import { aggregateStats, buildFileDiff } from './lib/diffEngine.ts'
import { downloadText } from './lib/download.ts'
import { num, splitPath } from './lib/format.ts'
import { searchRows } from './lib/search.ts'
import { pushToast } from './lib/toast.ts'
import type {
  CodeScope,
  ComparisonResponse,
  DiffOptions,
  FileContentResponse,
  SearchOptions,
  SearchResult,
  Side,
  Snapshot,
  SnapshotChange,
  SourceConfig,
  Theme,
  ViewMode,
} from './types.ts'

/**
 * 화면 모드 — 소스 코드 diff 인가, 데이터 스키마 대조인가.
 *
 * 좌우 선택(환경·날짜)은 두 모드가 **그대로 나눠 쓴다.** 고르는 자리를 두 벌 두면
 * 탭을 옮길 때마다 다시 골라야 하고, "지금 무엇을 견주고 있나" 가 둘로 갈린다.
 * 대신 아래 3단(밴드·옵션바·본문)은 통째로 갈린다 — 코드의 무시 옵션(공백·주석)은
 * 스키마에 하나도 안 맞고, 스키마에는 제 옵션이 따로 있다.
 */
type PaneMode = 'code' | 'schema'

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

/** 날짜별 변경 수를 아직 못 쓸 때 날짜 목록 위에 적을 말. 쓸 수 있으면 null */
function changeNoteOf(state: { left: unknown; error: string | null }): string | null {
  if (state.error) return `날짜별 변경 수를 세지 못해 전체 날짜를 보여줍니다 — ${state.error}`
  return state.left ? null : '날짜별 변경 수를 세는 중… 끝날 때까지 전체 날짜를 보여줍니다'
}

const readStored = (key: string, fallback: string): string =>
  localStorage.getItem(key) ?? fallback

export default function App() {
  /* ---------------- 외부 폴더 / 스냅샷 ---------------- */
  const [sourceSelection, setSourceSelection] = useState<SourceSelection>(loadSourceSelection)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  /**
   * 환경 폴더(운영/테스트) — **좌우가 각각 고른다.** 목록은 change/config.ts 에서 온다.
   * 환경마다 배포 시점이 달라 같은 날짜가 양쪽에 다 있으리라는 보장이 없다.
   */
  /** 환경을 좌우 함께 바꿀지 — 켜져 있으면 한쪽에서 고른 환경이 양쪽에 들어간다 */
  const [envLinked, setEnvLinked] = useState(loadEnvLinked)
  // 묶인 채 저장된 좌우가 어긋나 있으면 열 때 맞춘다
  const [envPair, setEnvPair] = useState(() =>
    envLinked ? linkEnvPair(loadEnvPair()) : loadEnvPair()
  )

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
  /**
   * 날짜를 **어떻게** 골랐나(`DateIntent`) — 환경·위치를 바꿔 목록을 새로 읽을 때 다시 적용한다.
   * 직접 고른 두 날짜가 새 목록에 다 있으면 그대로, 지난주는 새 목록으로 다시 계산, 안 되면 기본값.
   * 기본값으로 떨어져도 의도는 남겨 둔다 — 원래 환경으로 돌아오면 고른 날짜가 다시 나온다.
   */
  const dateIntent = useRef<DateIntent>(AUTO_INTENT)
  /** 지금 선택이 기본값으로 정해진 것인지 — 그때만 "최근 변경으로 맞추기" 가 끼어든다 */
  const autoPicked = useRef(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingSnapshots, setLoadingSnapshots] = useState(true)

  /* ---------------- 비교 결과 ---------------- */
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null)
  const [comparing, setComparing] = useState(false)

  /* ---------------- 선택 / 필터 ---------------- */
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /**
   * 동일한 파일을 펼쳐 볼지 — 목록 맨 아래 "동일한 파일 N개" 접힘 줄(`SameFold`).
   * 처음은 접혀 있다(바뀐 파일만 보인다). 예전의 "변경된 파일만" 체크박스를 대신한다.
   * 날짜·환경을 바꾸면 다시 접힌다 — 파일을 고를 때는 그대로 둔다(접히면 고른 파일이 사라진다).
   */
  const [sameOpen, setSameOpen] = useState(false)
  /**
   * 제외 목록에 걸린 파일을 펼쳐 볼지. **접힌 채로 시작한다** — 목록을 정리하려고 켠 기능이라
   * 켤 때마다 다시 접혀 있는 편이 맞고, 브라우저에 남기면 "펼쳐 둔 것을 잊은 채" 다음에
   * 다시 열게 된다. 접힌 상태에서도 몇 개가 접혔는지는 늘 보인다.
   */
  const [showExcluded, setShowExcluded] = useState(false)
  /**
   * 내 제외 목록 — 화면에서 바로 접고 이 브라우저에만 남는다.
   * 팀이 함께 쓰는 `excludeFile` 과 목적이 다르다 (`features/settings/localExclude.ts`).
   */
  const [myExclude, setMyExclude] = useState(loadLocalExclude)
  /** 스키마 쪽 내 목록 — 대상이 파일 경로가 아니라 테이블·컬럼이라 따로 둔다 */
  const [mySchemaExclude, setMySchemaExclude] = useState(loadMySchemaExclude)

  /**
   * 스키마 날짜 목록·선택 — **코드와 같은 헤더 컨트롤이 다룬다.**
   *
   * 고르는 자리는 하나지만 **목록은 갈라 둔다.** 스키마 덤프는 배포와 주기가 달라
   * 날짜가 코드와 다르고, 탭을 옮길 때마다 상대 쪽 선택이 흔들리면 안 된다.
   * 처음 한 번은 코드에서 고른 날짜에 맞춰 준다 (`matchSchemaDate`).
   */
  const [schemaLoaded, setSchemaLoaded] = useState<{ left: Snapshot[]; right: Snapshot[] }>({
    left: [],
    right: [],
  })
  const [schemaSelection, setSchemaSelection] = useState(EMPTY_SELECTION)
  /** 스키마 탭의 날짜 의도 — 덤프 날짜는 소스와 달라 따로 둔다 */
  const schemaIntent = useRef<DateIntent>(AUTO_INTENT)
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  /** 스키마 위치를 아직 안 적었으면 탭을 눌러도 읽지 않는다 */
  const schemaConfigured = (base.schemaRoot ?? '').trim() !== ''
  const fileSearchRef = useRef<HTMLInputElement | null>(null)

  /* ---------------- 선택 파일 본문 ---------------- */
  const [content, setContent] = useState<FileContentResponse | null>(null)
  const [contentError, setContentError] = useState<string | null>(null)

  /* ---------------- 보기 옵션 ---------------- */
  // 무시 옵션은 켜진 채로 시작하고 브라우저에 남는다 (features/settings/diffOptions.ts)
  const [options, setOptions] = useState<DiffOptions>(loadDiffOptions)
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
  const [mode, setMode] = useState<PaneMode>(() =>
    readStored('cd-mode', 'code') === 'schema' ? 'schema' : 'code'
  )

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

  useEffect(() => {
    localStorage.setItem('cd-mode', mode)
  }, [mode])

  useEffect(() => {
    saveLocalExclude(myExclude)
  }, [myExclude])

  useEffect(() => {
    saveMySchemaExclude(mySchemaExclude)
  }, [mySchemaExclude])

  /**
   * 목록에서 한 번 눌러 접거나 펼친다.
   * 접으면 파일이 목록에서 바로 사라지므로 **무엇을 접었는지와 되돌리기**를 알림으로 준다 —
   * 그러지 않으면 실수로 누른 것을 되돌리려고 작은 "제외" 글자를 찾아 펼쳐야 했다.
   */
  const toggleMyExclude = useCallback(
    (path: string) => {
      const adding = parseLocalExclude(myExclude).matches(path) === null
      setMyExclude((text) => toggleLocalExclude(text, path))
      if (!adding) return
      pushToast('info', `내 제외 목록에 넣었습니다 — ${splitPath(path).name}`, undefined, {
        label: '되돌리기',
        // 그사이 손으로 뺐으면 다시 넣지 않는다 (토글이라 두 번 돌면 도로 들어간다)
        run: () =>
          setMyExclude((text) =>
            parseLocalExclude(text).matches(path) === null ? text : toggleLocalExclude(text, path)
          ),
      })
    },
    [myExclude]
  )

  useEffect(() => {
    saveDiffOptions(options)
  }, [options])

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
      // 사람이 고른 것(직접 입력 · 지난주)을 새 목록에서 먼저 살린다
      setSelection((prev) => {
        const lefts = leftRes.loaded.items
        const rights = rightRes.loaded.items
        const restored = selectionFromIntent(dateIntent.current, lefts, rights, same, lastWeekRange(new Date()))
        autoPicked.current = restored === null
        if (restored) return restored
        // 기본값. 고른 게 있었는데 살릴 수 없으면 처음 열 때처럼 고른다 — 한쪽만 맞춘 어중간한 쌍을 남기지 않는다.
        // 같은 날짜끼리(지난주 · 변경 없음)는 ⟳ 새로고침에서만 지킨다
        const base = dateIntent.current.kind === 'auto' ? prev : EMPTY_SELECTION
        return normalizeSelection(base, lefts, rights, same, refresh)
      })
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

  /**
   * 날짜마다 바로 앞 날짜 대비 변경 수 — 날짜 고르기 목록의 "변경 N개" · "변경된 날짜만"
   * (`server/snapshotChanges.ts`).
   *
   * **목록이 들어온 뒤 따로** 묻는다. 로컬은 본문을 읽어 견줘야 해서 느릴 수 있는데, 그걸 기다리느라
   * 날짜 칸이 늦게 뜨면 안 된다. 세는 동안은 거르지 않고 전체를 보여준다.
   * 목록 객체가 바뀔 때마다(새로고침 포함) 다시 센다 — 서버도 새로고침 때 캐시를 비운다.
   */
  const [dateChanges, setDateChanges] = useState<{
    left: ReadonlyMap<string, SnapshotChange> | null
    right: ReadonlyMap<string, SnapshotChange> | null
    error: string | null
  }>({ left: null, right: null, error: null })

  useEffect(() => {
    const l = leftLoaded.source
    const r = rightLoaded.source
    setDateChanges({ left: null, right: null, error: null })
    if (!l || !r || leftLoaded.items.length === 0) return

    let alive = true
    const toMap = (items: SnapshotChange[]) => new Map(items.map((c) => [c.id, c]))
    const same = l === r
    void Promise.all([fetchSnapshotChanges(l), same ? null : fetchSnapshotChanges(r)])
      .then(([a, b]) => {
        if (!alive) return
        const left = toMap(a.items)
        setDateChanges({ left, right: b ? toMap(b.items) : left, error: null })
      })
      .catch((e: Error) => alive && setDateChanges({ left: null, right: null, error: e.message }))
    return () => {
      alive = false
    }
  }, [leftLoaded, rightLoaded])

  /* ================================================================
     좌우 비교 — 목록/통계는 서버가 만들어 준다 (본문은 안 받는다)
     ================================================================ */

  const comparisonSeq = useRef(0)

  /**
   * 의존성에 목록 **객체**(`leftLoaded`)를 통째로 둔다 — `.source` 만 보면 새로고침이 먹지 않는다.
   *
   * 새로고침은 위치도 날짜도 그대로 둔 채 목록만 다시 읽는 일이라 `.source` 도 `left`/`right` 도
   * 바뀌지 않는다. 그러면 이 effect 가 다시 돌지 않아 `loadSnapshots` 가 비워 둔 비교 결과가
   * 빈 채로 남고, 그 상태에서 무시 체크박스를 건드려 `options` 가 바뀌어야 그제야 비교가 돌았다.
   *
   * 목록을 새로 넣는 곳은 `loadSnapshots` 뿐이고 거기서 매번 새 객체를 만들므로,
   * 이렇게 넓혀도 비교가 더 자주 도는 일은 없다.
   */
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
  }, [leftLoaded, rightLoaded, leftSource, rightSource, left, right, options])

  /* ================================================================
     목록 필터링 & 선택
     ================================================================ */

  /**
   * 제외 목록에 걸리지 **않은** 파일 — 요약 카드와 합계가 보는 것.
   *
   * 접어 둔 파일까지 합계에 넣으면 "12개 변경" 인데 목록에는 9개만 보이게 된다.
   * (패키지 밴드는 서버가 같은 기준으로 만들어 준다 — `ComparisonResponse.packages`)
   */
  /**
   * 서버가 접은 것 위에 **내 목록**을 얹은 파일들.
   * 아래 계산은 전부 이 결과를 본다 — 두 목록이 같은 화면에서 하나처럼 보여야 한다.
   */
  const local = useMemo(
    () => applyLocalExclude(comparison?.files ?? [], myExclude),
    [comparison, myExclude]
  )

  const includedFiles = useMemo(() => local.files.filter((f) => !f.excluded), [local])

  /**
   * 목록에 보일 파일 — **바뀐 파일**과 **동일한 파일** 두 묶음(`splitSame`). 각 묶음 안은 경로순 그대로.
   * 바뀐 파일은 늘 보이고, 동일한 파일은 맨 아래 접힘 줄 밑에 — 펼쳤거나 검색 중일 때만 보인다.
   * **검색은 접기와 상관없이 전체에서** 찾는다. 이전/다음 파일 이동(`[` `]`)은 보이는 것만 따른다.
   */
  const searchingFiles = query.trim() !== ''
  const fileGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return splitSame(
      local.files.filter((f) => {
        if (f.excluded && !showExcluded) return false
        if (selectedPackage && f.packageName !== selectedPackage) return false
        if (q && !f.path.toLowerCase().includes(q)) return false
        return true
      })
    )
  }, [local, query, selectedPackage, showExcluded])
  const visibleFiles = useMemo(
    () => shownItems(fileGroups.changed, fileGroups.same, sameOpen, searchingFiles),
    [fileGroups, sameOpen, searchingFiles]
  )

  /** 바뀐 파일 없이 동일한 것만 접혀 있다 — 본문 자리에 "모두 동일 · 펼치기" 를 띄운다 (`AllSameNotice`) */
  const allSame =
    comparison !== null &&
    !loadingSnapshots &&
    !comparing &&
    fileGroups.changed.length === 0 &&
    fileGroups.same.length > 0

  // 날짜·환경이 바뀌면(= 다른 비교) 동일한 파일은 다시 접는다
  useEffect(() => {
    setSameOpen(false)
  }, [comparison?.left, comparison?.right, leftSource, rightSource])

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

  /**
   * 설정 창의 적용 — 위치와 두 내 제외 목록을 한 번에 넣는다.
   * 위치가 그대로면 위치 상태를 새 객체로 바꾸지 않는다 — 바꾸면 목록을 통째로 다시 읽는다
   * (내 제외 목록만 고쳤는데 SSH 를 다시 훑게 된다).
   */
  const applySettings = useCallback(
    (next: SettingsResult): void => {
      if (!sameSelection(next.selection, sourceSelection)) {
        saveSourceSelection(next.selection)
        setSourceSelection(next.selection)
      }
      setMyExclude(next.myExclude)
      setMySchemaExclude(next.mySchemaExclude)
      setSettingsOpen(false)
    },
    [sourceSelection]
  )

  /**
   * 한쪽 환경을 바꾸면 그쪽 루트가 바뀌고, 그 위치로 목록을 다시 읽는다
   * (위 useEffect 가 위치를 보고 있다).
   */
  const changeEnv = useCallback(
    (side: Side, id: string): void => {
      setEnvPair((prev) => {
        const next = pickEnv(prev, side, id, envLinked)
        saveEnvPair(next)
        return next
      })
    },
    [envLinked]
  )

  /**
   * 묶기를 켜는 순간 오른쪽이 왼쪽 환경으로 맞춰진다 (`linkEnvPair`).
   * 그러면 같은 환경 비교가 되어 날짜도 그 환경의 최근 변경으로 다시 골라진다 — 버튼 하나에
   * 양쪽 칸이 다 바뀌므로 **무엇이 왜 바뀌었는지 알린다.**
   */
  const toggleEnvLink = useCallback((): void => {
    const next = !envLinked
    setEnvLinked(next)
    saveEnvLinked(next)
    if (!next) return
    const linked = linkEnvPair(envPair)
    saveEnvPair(linked)
    setEnvPair(linked)
    if (linked.right === envPair.right) return
    pushToast(
      'info',
      `오른쪽을 ${envById(linked.right).label} 환경으로 맞췄습니다`,
      '양쪽이 같은 환경이 되어 고른 날짜(또는 지난주)가 그 환경에 있으면 그대로, 없으면 최근 변경으로 고릅니다.\n' +
        '묶기를 끄면 좌우 환경을 따로 고를 수 있습니다.'
    )
  }, [envLinked, envPair])

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
  /**
   * 스키마 날짜 목록을 읽는다. 스키마 탭을 열었을 때만 — 코드만 보는 사람에게
   * 접속을 하나 더 붙일 이유가 없다.
   */
  useEffect(() => {
    if (mode !== 'schema' || !schemaConfigured) return

    let alive = true
    setLoadingSchema(true)
    setSchemaError(null)

    fetchSchemaSnapshots(base, leftEnvPath, rightEnvPath)
      .then((res) => {
        if (!alive) return
        // 헤더 컨트롤은 `Snapshot` 을 다룬다. 스키마 파일에는 셀 파일·패키지가 없어
        // 0 으로 채우고, 목록 안내는 그때 수를 감춘다 (`SnapshotPicker.hint`)
        const toItems = (refs: { id: string; sortKey: string }[]): Snapshot[] =>
          refs.map((r) => ({ ...r, fileCount: 0, packageCount: 0 }))
        setSchemaLoaded({ left: toItems(res.left), right: toItems(res.right) })
      })
      .catch((e: Error) => alive && setSchemaError(e.message))
      .finally(() => alive && setLoadingSchema(false))

    return () => {
      alive = false
    }
  }, [mode, schemaConfigured, base, leftEnvPath, rightEnvPath])

  /**
   * 스키마 덤프 날짜마다 바로 앞 덤프 대비 **테이블** 변경 수 — 스키마 탭 날짜 목록의 "테이블 N개 바뀜".
   * 코드 쪽(`dateChanges`)과 같은 이유로 날짜 목록이 들어온 뒤 따로 묻는다.
   */
  const [schemaDateChanges, setSchemaDateChanges] = useState<{
    left: ReadonlyMap<string, SnapshotChange> | null
    right: ReadonlyMap<string, SnapshotChange> | null
    error: string | null
  }>({ left: null, right: null, error: null })

  useEffect(() => {
    setSchemaDateChanges({ left: null, right: null, error: null })
    if (mode !== 'schema' || !schemaConfigured || schemaLoaded.left.length === 0) return

    let alive = true
    const toMap = (items: SnapshotChange[]) => new Map(items.map((c) => [c.id, c]))
    fetchSchemaChanges(base, leftEnvPath, rightEnvPath)
      .then((res) => alive && setSchemaDateChanges({ left: toMap(res.left), right: toMap(res.right), error: null }))
      .catch((e: Error) => alive && setSchemaDateChanges({ left: null, right: null, error: e.message }))
    return () => {
      alive = false
    }
  }, [mode, schemaConfigured, schemaLoaded, base, leftEnvPath, rightEnvPath])

  /**
   * 목록이 들어오면 규칙에 맞게 바로잡는다.
   * 스키마 탭에서 고른 것(직접 입력 · 지난주)이 있으면 새 목록에서 먼저 살린다(`schemaIntent`).
   * 아직 아무것도 안 고른 상태거나 살릴 수 없으면 **코드에서 고른 날짜에 맞춘다** — 8월 배포를 보다가
   * 탭을 눌렀는데 9월 스키마가 뜨면 무엇을 보고 있는지 어긋난다.
   */
  useEffect(() => {
    setSchemaSelection((prev) => {
      const restored = selectionFromIntent(
        schemaIntent.current,
        schemaLoaded.left,
        schemaLoaded.right,
        sameSource,
        lastWeekRange(new Date())
      )
      if (restored) return restored
      const fresh = !(prev.left || prev.right) || schemaIntent.current.kind !== 'auto'
      const want = fresh
        ? { left: matchSchemaDate(schemaLoaded.left, left), right: matchSchemaDate(schemaLoaded.right, right) }
        : prev
      // 코드가 같은 날짜끼리(지난주 · 변경 없음)면 스키마도 같은 덤프끼리 — 코드에 맞출 때만
      const keepSame = fresh && left === right
      return normalizeSelection(want, schemaLoaded.left, schemaLoaded.right, sameSource, keepSame)
    })
    // 코드 날짜(left·right)는 **처음 맞출 때만** 쓴다 — 의존성에 넣으면 코드 날짜를
    // 옮길 때마다 스키마 선택이 따라 흔들린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaLoaded, sameSource])

  const changeSchemaSide = useCallback(
    (side: Side, id: string) => {
      const next = normalizeSelection(
        side === 'left' ? { ...schemaSelection, left: id } : { ...schemaSelection, right: id },
        schemaLoaded.left,
        schemaLoaded.right,
        sameSource
      )
      schemaIntent.current = { kind: 'manual', selection: next }
      setSchemaSelection(next)
    },
    [schemaSelection, schemaLoaded, sameSource]
  )

  /** 한 칸을 고른 것 — 고친 뒤의 두 날짜를 의도로 기억한다 (`dateIntent`) */
  const changeSide = useCallback(
    (side: Side, id: string) => {
      const next = normalizeSelection(
        side === 'left' ? { ...selection, left: id } : { ...selection, right: id },
        leftLoaded.items,
        rightLoaded.items,
        sameSource
      )
      dateIntent.current = { kind: 'manual', selection: next }
      autoPicked.current = false
      setSelection(next)
    },
    [selection, leftLoaded.items, rightLoaded.items, sameSource]
  )

  /**
   * 변경 이력 한 줄 · 빠른 선택 · 지난주 — 이전·이후를 **한 번에** 정한다 (따로 두 번 바꾸면 중간에 엉뚱한 비교가 뜬다).
   * 지난주는 날짜가 아니라 "지난주" 를 기억한다 — 환경을 바꾸면 그 환경의 지난주로 다시 고른다.
   */
  const changePair = useCallback(
    (left: string, right: string, preset?: 'lastWeek') => {
      // 쌍을 통째로 고른 것이라 같은 날짜(지난주 · 변경 없음)도 그대로 둔다
      const next = normalizeSelection({ left, right }, leftLoaded.items, rightLoaded.items, sameSource, true)
      dateIntent.current = preset === 'lastWeek' ? { kind: 'lastWeek' } : { kind: 'manual', selection: next }
      autoPicked.current = false
      setSelection(next)
    },
    [leftLoaded.items, rightLoaded.items, sameSource]
  )

  const changeSchemaPair = useCallback(
    (left: string, right: string, preset?: 'lastWeek') => {
      const next = normalizeSelection({ left, right }, schemaLoaded.left, schemaLoaded.right, sameSource, true)
      schemaIntent.current = preset === 'lastWeek' ? { kind: 'lastWeek' } : { kind: 'manual', selection: next }
      setSchemaSelection(next)
    },
    [schemaLoaded, sameSource]
  )

  /**
   * 처음 열 때 같은 환경이면 **가장 최근 변경**을 보여준다.
   *
   * 기본 선택은 "최신 날짜 · 그 바로 앞 날짜" 인데, 그 사이에 배포가 없었으면 두 폴더가 똑같아 빈 비교가
   * 뜬다(날짜가 매일 쌓이는 배치에서 흔하다). 변경 수가 들어오면 이전을 최근 변경의 앞 배포일로 옮긴다.
   * 사람이 고른 날짜가 살아 있으면(`autoPicked` 가 아니면) 손대지 않는다.
   */
  useEffect(() => {
    if (!sameSource || !autoPicked.current || !dateChanges.left) return
    const items = leftLoaded.items
    const latest = changeHistory(items, dateChanges.left).sets[0]
    const newest = items.find((s) => s.sortKey)?.id
    if (!latest || !newest) return
    setSelection(normalizeSelection({ left: latest.from, right: newest }, items, items, true))
  }, [dateChanges.left, leftLoaded.items, sameSource])

  /**
   * 헤더 컨트롤이 다룰 목록·선택.
   * 모드만 보고 갈아 끼우므로, 컨트롤 자체는 무엇을 고르는지 몰라도 된다.
   */
  const picker =
    mode === 'schema'
      ? {
          left: schemaLoaded.left,
          right: schemaLoaded.right,
          selection: schemaSelection,
          onChange: changeSchemaSide,
          onPair: changeSchemaPair,
          loading: loadingSchema,
        }
      : {
          left: leftLoaded.items,
          right: rightLoaded.items,
          selection,
          onChange: changeSide,
          onPair: changePair,
          loading: loadingSnapshots,
        }

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
      else if (e.key === '?') setHelpOpen(true)
      else handled = false

      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepHunk, goFile, toggleSync, toggleScope, stepMatch, searchOpen, closeSearch])

  /* ================================================================
     렌더
     ================================================================ */

  // 합계는 접어 둔 파일을 뺀 것으로 낸다 (`includedFiles` 주석 참고)
  const overall = useMemo(
    () => aggregateStats(includedFiles.map((f) => f.stats)),
    [includedFiles]
  )
  const changedCount = useMemo(
    () => includedFiles.filter((f) => f.status !== 'same').length,
    [includedFiles]
  )
  /* ---------------- 보고서 내려받기 ---------------- */

  /** 스키마를 읽는 동안 다시 누르지 못하게 한다 */
  const [reporting, setReporting] = useState(false)
  /** 본 버튼이 받을 보고서 — 마지막으로 고른 것, 처음은 통합 (`reportPreference.ts`) */
  const [reportKind, setReportKind] = useState(loadReportKind)

  /**
   * 스키마 탭에서 받는 **스키마 보고서**는 화면 그대로 — 지금 보고 있는 덤프 날짜를 쓴다.
   * 그 밖(코드 탭에서 고른 스키마 보고서 · 통합)은 소스 날짜에 가장 가까운 덤프로 맞춘다.
   */
  const pinnedSchema =
    mode === 'schema' && schemaSelection.left && schemaSelection.right ? schemaSelection : undefined

  /**
   * 보고서 종류마다 지금 받을 수 있는지, 못 받으면 왜인지 (`ReportButton` 이 메뉴에 그대로 적는다).
   */
  const reportOptions = useMemo((): Record<ReportKind, ReportOption> => {
    const codeReady = Boolean(comparison) && !comparing
    const codeWait = comparing ? '소스를 비교하는 중입니다' : '소스 비교가 끝나면 받을 수 있습니다'
    const noSchema = '스키마 위치가 설정돼 있지 않습니다 (⚙ 설정 → 위치 → 스키마 폴더)'
    return {
      code: { ok: codeReady, reason: codeWait, hint: '고른 날짜의 파일 변경 목록' },
      schema: {
        ok: schemaConfigured && (Boolean(pinnedSchema) || codeReady),
        reason: schemaConfigured ? codeWait : noSchema,
        hint: pinnedSchema
          ? '지금 보고 있는 스키마 날짜 그대로'
          : '소스 날짜에 가장 가까운 스키마 덤프로',
      },
      all: {
        ok: schemaConfigured && codeReady,
        reason: schemaConfigured ? codeWait : noSchema,
        hint: '소스 + 스키마를 한 문서로 (스키마는 소스 날짜에 맞춤)',
      },
    }
  }, [comparison, comparing, schemaConfigured, pinnedSchema])

  /**
   * 보고서를 md 로 내려받는다 (`features/report/report.ts`) — 통합 · 소스 · 스키마.
   *
   * 소스는 화면이 들고 있는 것(접은 파일을 뺀 `includedFiles`)을 그대로 쓰고,
   * 스키마는 탭을 안 열었을 수 있어 그 자리에서 읽는다 (`loadSchemaForReport`).
   *
   * 통합 보고서에서 스키마를 못 읽으면 소스만 담아 받되 **빠졌다고 알린다** — 모르고 공지에
   * 붙이면 "스키마 변경 없음" 으로 읽힌다. 스키마 보고서에서 못 읽으면 낼 것이 없어 받지 않는다.
   */
  const downloadReport = useCallback(
    async (kind: ReportKind): Promise<void> => {
      if (!reportOptions[kind].ok) return
      setReporting(true)
      const leftEnv = envById(envPair.left).label
      const rightEnv = envById(envPair.right).label
      const input: ReportInput = { code: null, schema: null }

      try {
        if (kind !== 'schema' && comparison) {
          input.code = {
            left: { env: leftEnv, date: comparison.left },
            right: { env: rightEnv, date: comparison.right },
            items: includedFiles,
          }
        }

        if (kind !== 'code') {
          const pinned = kind === 'schema' ? pinnedSchema : undefined
          const missing = (why: string): void => {
            if (kind === 'schema') pushToast('error', '스키마 보고서를 만들지 못했습니다', why)
            else pushToast('warn', '스키마는 보고서에서 빠졌습니다', why)
          }
          try {
            const schema = await loadSchemaForReport({
              source: base,
              leftEnv: leftEnvPath,
              rightEnv: rightEnvPath,
              sameSource,
              codeLeft: comparison?.left ?? '',
              codeRight: comparison?.right ?? '',
              pinned,
              myExclude: mySchemaExclude,
            })
            if (schema) {
              input.schema = {
                left: { env: leftEnv, date: schema.left },
                right: { env: rightEnv, date: schema.right },
                items: schema.tables,
                // 화면 날짜 그대로 받았으면 "대신 썼다" 고 적을 일이 없다
                wanted: pinned ?? { left: comparison?.left ?? '', right: comparison?.right ?? '' },
                sameDump: schema.sameDump,
              }
            } else {
              missing('고른 환경에 스키마 덤프가 없습니다.')
            }
          } catch (e) {
            missing((e as Error).message)
          }
        }

        if (input.code || input.schema) downloadText(reportFileName(input), buildReport(input))
      } finally {
        setReporting(false)
      }
    },
    [
      reportOptions,
      envPair,
      comparison,
      includedFiles,
      pinnedSchema,
      base,
      leftEnvPath,
      rightEnvPath,
      sameSource,
      mySchemaExclude,
    ]
  )

  /** 규칙 파일의 상태 — 읽기 실패를 알리는 데 쓴다 (접힌 수는 아래 `local` 이 합쳐 센다) */
  const exclude = comparison?.exclude ?? null

  /**
   * 지금 기다리는 일 — 없으면 null.
   * 날짜 목록을 읽는 동안은 비교도 시작 전이라, 이걸 따로 짚지 않으면 "비교할 파일이 없습니다" 가
   * 떠서 빈 폴더처럼 보인다. SSH 는 그 시간 대부분이 접속이라 "연결 중" 이라고만 적는다.
   */
  const loadingLabel = base.mode === 'ssh' ? 'SSH 연결 중…' : '날짜 목록을 읽는 중…'
  const busy = loadingSnapshots ? loadingLabel : comparing ? '비교하는 중…' : null

  /**
   * 목록이 비었을 때의 안내.
   * **접혀서 비었을 때를 따로 말한다** — "비교할 파일이 없습니다" 라고만 하면
   * 규칙을 너무 넓게 적어 전부 접어 놓고도 폴더가 비었다고 오해한다.
   */
  const emptyFileMessage = (): string => {
    if (busy) return busy
    if (local.excluded > 0 && !showExcluded) {
      return '보이는 파일이 모두 접혀 있습니다. 위의 "제외" 를 눌러 펼쳐 보세요.'
    }
    return '비교할 파일이 없습니다.'
  }

  /**
   * 스키마 탭이 소스와 다른 날짜를 보고 있으면 알린다.
   * 고르는 칸은 하나인데 탭마다 목록이 달라(`schemaSelection` 주석), 탭만 옮겼는데 날짜가 바뀐 것처럼
   * 보인다. 소스 날짜에 맞는 덤프가 없으면 가장 가까운 것을 쓴다 (`matchSchemaDate`).
   */
  const schemaDateNote =
    mode === 'schema' &&
    left &&
    right &&
    schemaSelection.left &&
    schemaSelection.right &&
    (schemaSelection.left !== left || schemaSelection.right !== right)
      ? `소스 비교(${left} → ${right})와 날짜가 다릅니다. 스키마 덤프는 배포와 주기가 달라 ` +
        `${schemaSelection.left} → ${schemaSelection.right} 덤프를 보고 있습니다.`
      : null

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

  return (
    <div className="app">
      {/* 실패를 눈앞으로 가져온다 — 배너만으로는 아래를 보고 있으면 놓친다 */}
      <Toasts />

      {settingsOpen && (
        <SettingsPanel
          value={sourceSelection}
          myExclude={myExclude}
          mySchemaExclude={mySchemaExclude}
          onApply={applySettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}

      <header className="header">
        <div className="brand">
          <span className="dot">◧</span>
          <span>환경 · 날짜별 소스 Diff</span>
        </div>

        <div className="header-spacer" />

        {/*
          환경 선택은 좌우 칸 안에 있다 — 한쪽만 바꿔 운영↔테스트를 견줄 수 있어야 하고,
          양쪽을 같은 환경으로 두면 그 환경의 두 날짜 비교가 된다.

          **코드든 스키마든 이 컨트롤 하나로 고른다.** 목록만 모드에 따라 갈아 끼운다 —
          고르는 자리를 두 벌 두면 탭을 옮길 때마다 다시 골라야 한다.
        */}
        <SnapshotPicker
          left={{
            envId: envPair.left,
            snapshots: picker.left,
            value: picker.selection.left,
            tagClass: envColorClass(envPair.left),
            changes: (mode === 'schema' ? schemaDateChanges : dateChanges).left,
          }}
          right={{
            envId: envPair.right,
            snapshots: picker.right,
            value: picker.selection.right,
            tagClass: envColorClass(envPair.right),
            changes: (mode === 'schema' ? schemaDateChanges : dateChanges).right,
          }}
          envChoices={ENV_CHOICES}
          sameSource={sameSource}
          onChangeSnapshot={picker.onChange}
          onChangePair={picker.onPair}
          onChangeEnv={changeEnv}
          envLinked={envLinked}
          onToggleEnvLink={toggleEnvLink}
          onRefresh={() => void loadSnapshots(leftSource, rightSource, true)}
          loading={picker.loading}
          // 코드는 파일, 스키마는 테이블 단위로 센다
          unit={mode === 'schema' ? '테이블' : '파일'}
          changeNote={changeNoteOf(mode === 'schema' ? schemaDateChanges : dateChanges)}
        />

        {/*
          보고서 — 본 버튼은 마지막으로 고른 보고서(처음은 통합), ▾ 에서 통합 · 소스 · 스키마를 고른다.
          고를 수 없는 것은 메뉴에 잠근 채 이유를 적는다 (`ReportButton`).
        */}
        <ReportButton
          primary={primaryKind(reportKind, schemaConfigured)}
          tab={mode === 'schema' ? 'schema' : 'code'}
          options={reportOptions}
          busy={reporting}
          onDownload={(kind) => void downloadReport(kind)}
          onPick={(kind) => {
            setReportKind(kind)
            saveReportKind(kind)
            void downloadReport(kind)
          }}
        />

        {/*
          지금 읽는 위치를 버튼이 직접 보여준다 — 경로를 헤더에 따로 적으면 길어서 버튼들이 둘째 줄로
          밀리고, "어디서 위치를 바꾸나" 도 따로 찾아야 했다. 전체 경로는 툴팁에 있다.
        */}
        <button
          type="button"
          className="btn sm source-btn"
          onClick={() => setSettingsOpen(true)}
          title={[
            presetLabel,
            root || describeSource(leftSource),
            // 좌우가 다른 곳이면 버튼 한 칸에 다 넣을 수 없다 — 툴팁에는 둘 다 보여준다
            sameSource ? null : rightLoaded.root || describeSource(rightSource),
            '누르면 위치·제외 규칙 설정을 엽니다',
          ]
            .filter(Boolean)
            .join('\n')}
        >
          <span aria-hidden="true">⚙</span>
          <span className={`src-tag ${base.mode}`}>{base.mode === 'ssh' ? 'SSH' : '폴더'}</span>
          <span className="source-name">{presetLabel ?? '직접 입력'}</span>
          <span className="source-path">{shortSource(base)}</span>
        </button>

        <button
          type="button"
          className="btn sm"
          onClick={() => setHelpOpen(true)}
          title="도움말 · 단축키 (?)"
          aria-label="도움말"
        >
          ?
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

      {schemaDateNote && <div className="banner info">ℹ {schemaDateNote}</div>}

      {/* 좌우 선택은 위에 그대로 두고 아래 3단만 갈린다 (`PaneMode` 주석 참고) */}
      <div className="mode-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'code'}
          className={`mode-tab ${mode === 'code' ? 'active' : ''}`}
          onClick={() => setMode('code')}
        >
          코드 비교
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'schema'}
          className={`mode-tab ${mode === 'schema' ? 'active' : ''}`}
          onClick={() => setMode('schema')}
          title="같은 좌우 선택으로 데이터 스키마(테이블 정의)를 견줍니다"
        >
          스키마 비교
        </button>
      </div>

      {mode === 'code' ? (
        <>
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

          <ViewOptions
            options={options}
            onChangeOptions={setOptions}
            wrap={wrap}
            onChangeWrap={setWrap}
            fontSize={codeFontSize}
            onChangeFontSize={setCodeFontSize}
          />

          <div style={{ flex: 1 }} />

          <button type="button" className="btn sm" onClick={() => setShowSidebar((v) => !v)}>
            {showSidebar ? '◧ 목록 숨기기' : '▣ 목록 보기'}
          </button>
        </div>

        <div className={`main ${showSidebar ? '' : 'no-sidebar'}`}>
          {showSidebar && (
            <aside className="sidebar">
              {/* 비교한 파일이 없을 때 유사도 100% 는 오해를 부르므로 카드를 띄우지 않는다 */}
              {comparison && includedFiles.length > 0 ? (
                <SummaryCard
                  stats={overall}
                  fileCount={includedFiles.length}
                  changedCount={changedCount}
                  leftLabel={`${leftTag} ${left}`}
                  rightLabel={`${rightTag} ${right}`}
                  loading={comparing}
                />
              ) : (
                <div className="summary-empty" role="status">
                  {busy && <span className="spinner" aria-hidden="true" />}
                  {busy ?? '비교할 파일이 없습니다.'}
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
              </div>

              <div className="filelist-head">
                {searchingFiles ? '찾은 바뀐 파일' : '바뀐 파일'} <b>{num(fileGroups.changed.length)}</b>개
                {selectedPackage && <span className="pkg-filter">· {selectedPackage}</span>}
                {comparison && comparison.skipped > 0 && (
                  <span
                    className="skipped"
                    title={
                      '확장자가 대상이 아니거나 용량을 넘어 아예 읽지 않은 파일입니다.\n' +
                      'change/config.ts 의 SCAN 에서 정합니다.'
                    }
                  >
                    · 대상 밖 {comparison.skipped}
                  </span>
                )}

                {/* 규칙 파일을 못 읽은 것은 조용히 넘어가면 안 된다 —
                    접힌 줄 알았던 파일이 그냥 다 보이고 있는 상태다 */}
                {exclude?.error && (
                  <span className="excl-error" title={exclude.error}>
                    · ⚠ 제외 목록 오류
                  </span>
                )}

                {local.excluded > 0 && (
                  <button
                    type="button"
                    className={`excl-toggle ${showExcluded ? 'on' : ''}`}
                    onClick={() => setShowExcluded((v) => !v)}
                    title={[
                      exclude?.file
                        ? `규칙 파일(${exclude.file}) ${exclude.rules}개`
                        : '규칙 파일 없음',
                      local.byMine > 0 ? `내 제외 목록 ${local.byMine}개` : null,
                      `합쳐서 ${local.excluded}개를 접었습니다.`,
                      local.excludedChanged > 0
                        ? `그중 ${local.excludedChanged}개는 실제로 바뀌었습니다 — 눌러서 확인하세요.`
                        : '눌러서 펼쳐 볼 수 있습니다.',
                    ]
                      .filter(Boolean)
                      .join('\n')}
                  >
                    · 제외 {local.excluded}
                    {local.byMine > 0 && <i className="mine"> (내 {local.byMine})</i>}
                    {local.excludedChanged > 0 && <b> · 변경 {local.excludedChanged}</b>}
                  </button>
                )}
              </div>

              <FileList
                files={fileGroups.changed}
                same={fileGroups.same}
                sameOpen={sameOpen}
                searching={searchingFiles}
                onToggleSame={() => setSameOpen((v) => !v)}
                selectedPath={selectedFile?.path ?? null}
                onSelect={setSelectedPath}
                onToggleExclude={toggleMyExclude}
                emptyMessage={emptyFileMessage()}
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
                  path={selectedFile.path}
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
                  {!contentError && (
                    <span className="loading">
                      <span className="spinner" aria-hidden="true" /> 불러오는 중…
                    </span>
                  )}
                </div>
                <div className="empty">
                  {contentError ? (
                    <>
                      <h2>파일을 읽지 못했습니다</h2>
                      <p className="error-detail">{contentError}</p>
                    </>
                  ) : (
                    <>
                      <span className="spinner lg" aria-hidden="true" />
                      <h2>파일을 읽는 중입니다</h2>
                    </>
                  )}
                </div>
              </>
            ) : allSame ? (
              <AllSameNotice
                count={fileGroups.same.length}
                noun="파일"
                excluded={showExcluded ? 0 : local.excluded}
                sameDate={sameSource && left === right ? left : null}
                onOpen={() => setSameOpen(true)}
              />
            ) : (
              <div className="empty" role="status">
                {busy && <span className="spinner lg" aria-hidden="true" />}
                <h2>{busy ?? '비교할 파일을 고르세요'}</h2>
                {loadingSnapshots ? (
                  <p>
                    {describeSource(leftSource)}{' '}
                    {leftSource.mode === 'ssh' ? '에 연결하고 있습니다.' : '에서 날짜 폴더를 찾고 있습니다.'}
                  </p>
                ) : (
                  <p>
                    위에서 좌우의 환경·날짜를 고르면 바뀐 패키지와 파일이 표시됩니다.
                    <br />
                    왼쪽 목록에서 파일을 누르면 diff 가 열립니다.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
        </>
      ) : (
        <SchemaPane
          source={base}
          leftEnvId={envPair.left}
          rightEnvId={envPair.right}
          leftDate={schemaSelection.left}
          rightDate={schemaSelection.right}
          snapshotsLoaded={schemaLoaded.left.length > 0 || schemaLoaded.right.length > 0}
          listError={schemaError}
          loadingList={loadingSchema}
          codeFontSize={codeFontSize}
          onChangeFontSize={setCodeFontSize}
          showSidebar={showSidebar}
          onToggleSidebar={() => setShowSidebar((v) => !v)}
          myExclude={mySchemaExclude}
          onChangeMyExclude={setMySchemaExclude}
        />
      )}
    </div>
  )
}
