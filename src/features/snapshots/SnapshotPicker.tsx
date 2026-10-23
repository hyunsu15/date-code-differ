import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { leftChoices, resolveSnapshotInput, rightChoices } from './selection.ts'
import {
  arrangeDates,
  arrangeSets,
  changeHistory,
  changeTotal,
  countDetail,
  currentSetIndex,
  dayLabel,
  loadDatePrefs,
  saveDatePrefs,
  type ChangeHistory,
  type ChangeSet,
  type ChangeUnit,
  type DateListPrefs,
} from './dateList.ts'
import type { EnvFolder, Side, Snapshot, SnapshotChange } from '../../types.ts'

/** 변경 수를 모를 때(세는 중 · 날짜 아닌 폴더) 줄 오른쪽에 둘 말 — 예전 목록 안내와 같다 */
function fallbackHint(s: Snapshot): string {
  if (s.fileCount === 0 && s.packageCount === 0) return s.sortKey ? '' : '날짜 아님'
  const notDate = s.sortKey ? '' : ' · 날짜 아님'
  return `파일 ${s.fileCount} · 패키지 ${s.packageCount}${notDate}`
}

/** 타이핑한 글자로 날짜를 찾는다 — 구분자(`-` `.` `_`)를 빼고도 맞춘다 (`0801` → `2026-08-01`) */
const matchesQuery = (s: Snapshot, query: string): boolean => {
  const bare = query.replace(/[-./_\s]/g, '')
  return s.id.toLowerCase().includes(query) || (bare !== '' && s.sortKey.includes(bare))
}

/** 환경이 다를 때 목록 맨 위의 빠른 선택 — `운영 최신 ↔ 테스트 최신` */
interface QuickPair {
  label: string
  left: string
  right: string
}

interface ComboProps {
  side: Side
  /** 칸 왼쪽에 붙는 표시 — 환경이 설정돼 있으면 환경 선택이 이 자리에 들어간다 */
  tag: ReactNode
  /** 스크린리더용 이름 (`tag` 가 선택 컨트롤일 수 있어 따로 받는다) */
  label: string
  /** 지금 확정된 스냅샷 id */
  value: string
  /** 이 칸이 고를 수 있는 날짜 — 날짜 직접 · 타이핑이 여기서 찾는다 */
  choices: Snapshot[]
  /** 변경 이력(쌍). 같은 환경이고 변경 수를 받았을 때만 있다 */
  history: ChangeHistory | null
  /**
   * 이 칸 환경의 배포일 정보 — 날짜 직접에서 "이날 N개" 를 붙이는 데 쓴다.
   * 환경이 달라 이력(쌍)은 없어도, 각 환경 안에서 언제 배포가 있었는지는 알 수 있다.
   */
  dayHistory: ChangeHistory | null
  /** 변경 이력 탭을 둘지 — 같은 환경일 때만(환경이 다르면 시간 순서가 없다) */
  allowSets: boolean
  /** 지금 고른 이전·이후 — 이력에서 "지금" 표시를 단다 */
  pair: { left: string; right: string }
  /** 이력 한 줄을 고르면 이전·이후를 함께 정한다 */
  onPickPair: (left: string, right: string) => void
  /** 환경이 다를 때 맨 위 빠른 선택. 없으면 null */
  quick: QuickPair | null
  /** 무엇을 셌나 — 코드 탭은 파일, 스키마 탭은 테이블 */
  unit: ChangeUnit
  /** 변경 수를 못 쓸 때의 안내 (세는 중 · 실패) */
  changeNote: string | null
  prefs: DateListPrefs
  /** 바꿀 것만 넘긴다 (예: `{ order: 'asc' }`) */
  onPrefs: (patch: Partial<DateListPrefs>) => void
  onCommit: (id: string) => void
  disabled: boolean
  /** 날짜 목록을 읽는 중 — 빈 칸에 "없음" 대신 "읽는 중" 을 적는다 */
  loading: boolean
}

/** 목록 한 줄 — 이력 쌍이거나 날짜 하나 */
type Row = { kind: 'set'; set: ChangeSet } | { kind: 'date'; snap: Snapshot } | { kind: 'quick'; quick: QuickPair }

/**
 * 날짜 폴더 입력칸 + 고르기 목록.
 *
 * 목록은 두 가지로 본다 — **변경 이력**: 바뀐 일 하나 = 이전·이후 한 쌍, 누르면 두 칸이 함께 정해진다.
 * **날짜 직접**: 이 칸만 고른다(여러 배포를 건너뛰어 보거나 아무 날짜끼리 견줄 때).
 * 이력 줄의 숫자는 그 쌍을 고르면 화면에 나올 결과 그대로다 (`dateList.ts` 주석 참고).
 *
 * 타이핑은 보기와 상관없이 **이 칸의 전체 날짜에서** 찾는다. 확정은 Enter · 포커스 아웃 · 목록 선택,
 * 해석할 수 없는 입력은 원래 값으로 되돌린다. 키보드: ↓↑ 로 훑고 Enter 로 고른다. Esc 는 닫고 되돌린다.
 */
function SnapshotCombo({
  side,
  tag,
  label,
  value,
  choices,
  history,
  dayHistory,
  allowSets,
  pair,
  onPickPair,
  quick,
  unit,
  changeNote,
  prefs,
  onPrefs,
  onCommit,
  disabled,
  loading,
}: ComboProps) {
  const [draft, setDraft] = useState(value)
  const [typing, setTyping] = useState(false)
  const [open, setOpen] = useState(false)
  /** ↓↑ 로 짚고 있는 목록 줄. -1 이면 아무것도 */
  const [cursor, setCursor] = useState(-1)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 바깥에서 값이 바뀌면(자동 보정 포함) 입력창도 따라간다
  useEffect(() => {
    setDraft(value)
    setTyping(false)
  }, [value])

  // 타이핑 중이면서 해석되지 않는 상태만 오류로 본다 (빈 칸은 아직 오류가 아니다)
  const unresolved = typing && draft.trim() !== '' && !resolveSnapshotInput(choices, draft)

  const query = typing ? draft.trim().toLowerCase() : ''
  /** 지금 보기 — 같은 환경이 아니면 날짜 직접뿐. 검색 중에는 늘 날짜 */
  const view = query ? 'dates' : allowSets ? prefs.view : 'dates'
  const setsReady = view === 'sets' && history !== null

  const rows: Row[] = query
    ? arrangeDates(choices, prefs.order)
        .filter((s) => matchesQuery(s, query))
        .map((snap) => ({ kind: 'date', snap }))
    : setsReady
      ? arrangeSets(history.sets, prefs.order).map((set) => ({ kind: 'set', set }))
      : [
          ...(quick ? [{ kind: 'quick', quick } as Row] : []),
          ...arrangeDates(choices, prefs.order).map((snap): Row => ({ kind: 'date', snap })),
        ]
  const currentSet = history ? history.sets[currentSetIndex(history, pair.left, pair.right)] : undefined

  // 짚은 줄이 보이게 — 키보드로 내려가다 목록 밖으로 나가지 않게
  useEffect(() => {
    if (cursor < 0) return
    listRef.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  /** 해석되면 확정하고, 안 되면 마지막 확정값으로 되돌린다 */
  const commit = (): void => {
    const hit = resolveSnapshotInput(choices, draft)
    setTyping(false)
    // 표기가 달라도(`20260801` → `2026-08-01`) 항상 실제 폴더명으로 맞춘다
    setDraft(hit ? hit.id : value)
    if (hit && hit.id !== value) onCommit(hit.id)
  }

  const close = (): void => {
    setOpen(false)
    setCursor(-1)
    setTyping(false)
  }

  const choose = (row: Row): void => {
    close()
    if (row.kind === 'set') onPickPair(row.set.from, row.set.to)
    else if (row.kind === 'quick') onPickPair(row.quick.left, row.quick.right)
    else {
      setDraft(row.snap.id)
      if (row.snap.id !== value) onCommit(row.snap.id)
    }
  }

  const change = (next: string): void => {
    setDraft(next)
    setTyping(true)
    setOpen(true)
    setCursor(-1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      if (rows.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setCursor((c) => (c < 0 ? (step > 0 ? 0 : rows.length - 1) : (c + step + rows.length) % rows.length))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (open && cursor >= 0 && rows[cursor]) choose(rows[cursor])
      else commit()
      setOpen(false)
      e.currentTarget.blur()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(value)
      close()
    }
  }

  /** 목록 위 버튼 — 누를 때 입력칸 포커스를 뺏지 않는다(뺏기면 목록이 닫힌다) */
  const toggle =
    (next: Partial<DateListPrefs>) =>
    (e: MouseEvent): void => {
      e.preventDefault()
      onPrefs(next)
      setCursor(-1)
    }

  return (
    <div className={`pick ${side}${unresolved ? ' invalid' : ''}`}>
      {tag}
      <input
        type="text"
        value={draft}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          commit()
          setOpen(false)
          setCursor(-1)
        }}
        onFocus={(e) => {
          e.currentTarget.select()
          setOpen(true)
        }}
        onClick={() => setOpen(true)}
        disabled={disabled}
        placeholder={loading ? '읽는 중…' : disabled ? '— 없음 —' : '날짜 입력'}
        aria-label={label}
        aria-invalid={unresolved}
        aria-expanded={open}
        aria-haspopup="listbox"
        autoComplete="off"
        spellCheck={false}
      />

      {open && !disabled && (
        // 목록 안을 눌러도 입력칸 포커스를 잃지 않게 — 잃으면 blur 로 목록이 먼저 닫혀 클릭이 안 먹는다
        <div className="date-menu" onMouseDown={(e) => e.preventDefault()}>
          <div className="date-tools">
            {query ? (
              // 검색은 보기와 **따로** 늘 이 칸의 전체 날짜에서 찾는다 — 그 사실을 탭 자리에 적어 둔다
              <span className="searching">전체 날짜에서 검색 · {rows.length}개</span>
            ) : allowSets ? (
              <span className="seg" role="tablist" aria-label="보기">
                <button
                  type="button"
                  role="tab"
                  className={view === 'sets' ? 'on' : ''}
                  aria-selected={view === 'sets'}
                  onMouseDown={toggle({ view: 'sets' })}
                  title="바뀐 일 하나 = 이전·이후 한 쌍. 누르면 두 칸이 함께 정해지고, 줄의 숫자가 그대로 화면에 나옵니다"
                >
                  변경 이력
                </button>
                <button
                  type="button"
                  role="tab"
                  className={view === 'dates' ? 'on' : ''}
                  aria-selected={view === 'dates'}
                  onMouseDown={toggle({ view: 'dates' })}
                  title="이 칸의 날짜만 고릅니다 — 여러 배포를 건너뛰어 보거나 아무 날짜끼리 견줄 때"
                >
                  날짜 직접
                </button>
              </span>
            ) : (
              <span className="searching muted">날짜 직접</span>
            )}
            <span className="seg" role="group" aria-label="순서">
              <button
                type="button"
                className={prefs.order === 'desc' ? 'on' : ''}
                aria-pressed={prefs.order === 'desc'}
                onMouseDown={toggle({ order: 'desc' })}
              >
                최신순
              </button>
              <button
                type="button"
                className={prefs.order === 'asc' ? 'on' : ''}
                aria-pressed={prefs.order === 'asc'}
                onMouseDown={toggle({ order: 'asc' })}
              >
                오래된순
              </button>
            </span>
          </div>

          {!query && view === 'sets' && !history && changeNote && <div className="date-note">{changeNote}</div>}

          <div className="date-list" role="listbox" aria-label={label} ref={listRef}>
            {rows.length === 0 && (
              <div className="date-empty">
                {query
                  ? '맞는 날짜가 없습니다'
                  : setsReady
                    ? '바뀐 이력이 없습니다 — 날짜 직접에서 고르세요'
                    : '고를 날짜가 없습니다'}
              </div>
            )}
            {rows.map((row, i) => {
              const cls = (extra: string) =>
                ['date-row', extra, i === cursor ? 'cursor' : ''].filter(Boolean).join(' ')
              const pick = (e: MouseEvent) => {
                e.preventDefault()
                choose(row)
              }

              if (row.kind === 'set') {
                const isCurrent = row.set === currentSet
                return (
                  <button
                    key={`${row.set.from}>${row.set.to}`}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    data-i={i}
                    className={cls(`set-row k-changed${isCurrent ? ' current' : ''}`)}
                    onMouseDown={pick}
                  >
                    <span className="d">
                      {row.set.from} <i className="arrow">→</i> {row.set.to}
                    </span>
                    <span className="c">
                      {unit} {changeTotal(row.set)}개 바뀜
                    </span>
                    <span className="x">
                      {countDetail(row.set)}
                      {isCurrent && <b className="now"> · 지금 보는 비교</b>}
                    </span>
                  </button>
                )
              }

              if (row.kind === 'quick') {
                const isCurrent = row.quick.left === pair.left && row.quick.right === pair.right
                return (
                  <button
                    key="quick"
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    data-i={i}
                    className={cls(`quick-row${isCurrent ? ' current' : ''}`)}
                    onMouseDown={pick}
                  >
                    <span className="d">{row.quick.label}</span>
                    <span className="c">
                      {row.quick.left} ↔ {row.quick.right}
                    </span>
                  </button>
                )
              }

              const s = row.snap
              const day = dayLabel(dayHistory, s.id, unit)
              return (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={s.id === value}
                  data-i={i}
                  className={cls(`${day && day !== '처음' ? 'k-deploy' : ''}${s.id === value ? ' current' : ''}`)}
                  onMouseDown={pick}
                >
                  <span className="d">
                    {day && day !== '처음' && <i className="dot" aria-hidden="true" />}
                    {s.id}
                  </span>
                  <span className="c muted">{day || (dayHistory ? '' : fallbackHint(s))}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** 한쪽이 보고 있는 곳 */
export interface PickerSide {
  /** 고른 환경 폴더 id. 환경 설정이 없으면 빈 문자열 */
  envId: string
  /** 그 환경에서 읽어온 날짜 폴더들 */
  snapshots: Snapshot[]
  /** 지금 고른 날짜 폴더 */
  value: string
  /** 환경 색 클래스 (`env-c0` …). 환경 설정이 없으면 빈 문자열 */
  tagClass: string
  /** 날짜별 바로 앞 날짜 대비 변경 수. 모르면 null */
  changes: ReadonlyMap<string, SnapshotChange> | null
}

interface SnapshotPickerProps {
  left: PickerSide
  right: PickerSide
  /** 환경 선택지. 비어 있으면 환경 고르는 자리가 아예 없다 (`change/config.ts` 의 `ENV_FOLDERS`) */
  envChoices: EnvFolder[]
  /** 좌우가 같은 곳을 보는지 — 날짜 후보와 순서 규칙이 여기서 갈린다 */
  sameSource: boolean
  onChangeSnapshot: (side: Side, id: string) => void
  /** 이전·이후를 함께 정한다 (변경 이력 한 줄 · 빠른 선택) */
  onChangePair: (left: string, right: string) => void
  onChangeEnv: (side: Side, envId: string) => void
  /** 환경을 좌우 함께 바꾸는 중인지 */
  envLinked: boolean
  onToggleEnvLink: () => void
  onRefresh: () => void
  /** 스냅샷 목록 자체를 다시 읽는 중 — 비교 중에는 입력을 막지 않는다 */
  loading: boolean
  /** 무엇을 셌나 — 코드 탭은 파일, 스키마 탭은 테이블 */
  unit: ChangeUnit
  /** 변경 수를 못 쓸 때의 안내 (세는 중 · 실패). 쓸 수 있으면 null */
  changeNote: string | null
}

/**
 * 비교할 두 곳을 고른다 — **좌우가 각각 (환경, 날짜)** 를 고른다.
 *
 * 같은 환경이면 날짜 칸을 눌렀을 때 **변경 이력**(이전·이후 한 쌍씩)이 먼저 나온다. 환경이 다르면
 * 시간 순서가 없어 이력이 성립하지 않으므로 날짜를 한쪽씩 고르고, 맨 위에 `운영 최신 ↔ 테스트 최신` 을 둔다.
 *
 * 환경이 같으면 `이후` 후보에 `이전` 보다 최신인 날짜만 담긴다. 환경이 다르면 그 규칙을 걸지 않는다 —
 * 운영 9/1 과 테스트 8/15 는 거꾸로 된 비교가 아니라 "테스트가 뒤처져 있다" 는 정상적인 질문이다.
 */
export default function SnapshotPicker({
  left,
  right,
  envChoices,
  sameSource,
  onChangeSnapshot,
  onChangePair,
  onChangeEnv,
  envLinked,
  onToggleEnvLink,
  onRefresh,
  loading,
  unit,
  changeNote,
}: SnapshotPickerProps) {
  /** 날짜 목록 보기 방식 — 좌우가 같이 쓰고 이 브라우저에 남는다. 처음은 변경 이력 · 최신순 */
  const [prefs, setPrefs] = useState<DateListPrefs>(loadDatePrefs)
  /** 바뀐 것만 받아 **최신 값에** 얹는다 — 연달아 누르면 앞의 변경이 묵은 값으로 덮이지 않게 */
  const changePrefs = (patch: Partial<DateListPrefs>): void => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      saveDatePrefs(next)
      return next
    })
  }

  // 같은 곳이면 두 날짜가 필요하고, 다른 곳이면 각자 하나씩 있으면 된다
  const comparable = sameSource
    ? left.snapshots.length >= 2
    : left.snapshots.length > 0 && right.snapshots.length > 0
  const disabled = !comparable || loading

  /** 각 칸 환경의 배포 이력 — 변경 수를 받았을 때만 */
  const leftHistory = left.changes ? changeHistory(left.snapshots, left.changes) : null
  const rightHistory = sameSource ? leftHistory : right.changes ? changeHistory(right.snapshots, right.changes) : null
  /** 변경 이력(쌍) — 같은 환경일 때만. 좌우 칸이 같은 이력을 본다 */
  const history = sameSource ? leftHistory : null

  /** 환경이 다를 때 맨 위 빠른 선택 — 가장 흔한 질문 "지금 둘이 얼마나 다른가" */
  const envLabel = (id: string): string => envChoices.find((e) => e.id === id)?.label || id
  const quick: QuickPair | null =
    !sameSource && left.snapshots[0] && right.snapshots[0]
      ? {
          label: `${envLabel(left.envId)} 최신 ↔ ${envLabel(right.envId)} 최신`,
          left: left.snapshots[0].id,
          right: right.snapshots[0].id,
        }
      : null

  const pair = { left: left.value, right: right.value }

  /**
   * 환경 선택은 **날짜가 없어도 열어 둔다.**
   * 고른 환경에 날짜 폴더가 없을 때 여기까지 잠기면 다른 환경으로 빠져나갈 수가 없다.
   */
  const envTag = (side: Side, state: PickerSide): ReactNode => (
    <select
      className={`side-tag env-select ${state.tagClass}`}
      value={state.envId}
      onChange={(e) => onChangeEnv(side, e.target.value)}
      disabled={loading}
      aria-label={`${side === 'left' ? '기준' : '대상'} 환경`}
      title="루트 아래 환경 폴더 (change/config.ts 의 ENV_FOLDERS)"
    >
      {envChoices.map((choice) => (
        <option key={choice.id} value={choice.id}>
          {choice.label}
        </option>
      ))}
    </select>
  )

  /** 환경 설정이 없으면 예전처럼 이전/이후 라벨만 붙는다 */
  const tagFor = (side: Side, state: PickerSide): ReactNode =>
    envChoices.length > 0 ? (
      envTag(side, state)
    ) : (
      <span className="side-tag">{side === 'left' ? '이전' : '이후'}</span>
    )

  const shared = {
    history,
    allowSets: sameSource,
    pair,
    onPickPair: onChangePair,
    quick,
    unit,
    changeNote,
    prefs,
    onPrefs: changePrefs,
    disabled,
    loading,
  }

  return (
    <div className="snapshot-picker">
      <SnapshotCombo
        side="left"
        tag={tagFor('left', left)}
        label="기준 날짜"
        value={left.value}
        choices={leftChoices(left.snapshots, sameSource)}
        dayHistory={leftHistory}
        onCommit={(id) => onChangeSnapshot('left', id)}
        {...shared}
      />

      <span className="pick-arrow" aria-hidden="true">
        →
      </span>

      <SnapshotCombo
        side="right"
        tag={tagFor('right', right)}
        label="대상 날짜"
        value={right.value}
        choices={rightChoices(right.snapshots, left.value, sameSource)}
        dayHistory={rightHistory}
        onCommit={(id) => onChangeSnapshot('right', id)}
        {...shared}
      />

      {/*
        환경이 둘 이상일 때만 의미가 있다. 켜면 오른쪽이 왼쪽 환경으로 맞춰지고,
        그 뒤로는 어느 쪽에서 골라도 양쪽이 같이 바뀐다 (운영 두 날짜 ↔ 테스트 두 날짜).
        아이콘은 동기 스크롤 토글과 같은 🔗 — 이 화면에서 "좌우가 함께 움직인다" 는 뜻이다.
      */}
      {envChoices.length > 1 && (
        <button
          type="button"
          className={`btn sm env-link${envLinked ? ' on' : ''}`}
          onClick={onToggleEnvLink}
          disabled={loading}
          aria-pressed={envLinked}
          title={
            envLinked
              ? '환경 묶음 켜짐 · 한쪽 환경을 바꾸면 양쪽이 같이 바뀝니다. 클릭하면 좌우를 따로 고릅니다'
              : '켜면 양쪽 환경을 한 번에 바꿉니다 (오른쪽이 왼쪽 환경으로 맞춰집니다)'
          }
        >
          🔗 환경 묶기
        </button>
      )}

      <button
        type="button"
        className="btn sm"
        onClick={onRefresh}
        disabled={loading}
        title="외부 폴더를 다시 읽습니다"
      >
        {/* 새로고침은 화면을 비우지 않고 읽으므로, 읽는 중인 것은 이 버튼이 알린다 */}
        {loading ? (
          <>
            <span className="spinner" aria-hidden="true" /> 읽는 중…
          </>
        ) : (
          '⟳ 새로고침'
        )}
      </button>
    </div>
  )
}
