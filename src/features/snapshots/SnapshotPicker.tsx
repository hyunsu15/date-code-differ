import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { leftChoices, resolveSnapshotInput, rightChoices } from './selection.ts'
import type { EnvFolder, Side, Snapshot } from '../../types.ts'

/**
 * 폴더명은 디스크에 있는 그대로 보여준다 (`20260801` 을 `2026-08-01` 로 고쳐 쓰지 않는다).
 * 날짜로 읽히지 않은 폴더만 따로 표시해, 왜 목록 아래로 밀렸는지 알 수 있게 한다.
 */
function hint(s: Snapshot): string {
  const notDate = s.sortKey ? '' : ' · 날짜 아님'
  return `파일 ${s.fileCount} · 패키지 ${s.packageCount}${notDate}`
}

interface ComboProps {
  side: Side
  /** 칸 왼쪽에 붙는 표시 — 환경이 설정돼 있으면 환경 선택이 이 자리에 들어간다 */
  tag: ReactNode
  /** 스크린리더용 이름 (`tag` 가 선택 컨트롤일 수 있어 따로 받는다) */
  label: string
  /** 지금 확정된 스냅샷 id */
  value: string
  choices: Snapshot[]
  onCommit: (id: string) => void
  disabled: boolean
}

/**
 * 날짜 폴더 입력창.
 * 직접 타이핑하거나 목록에서 고를 수 있다 — 목록은 `<datalist>` 라 ↑↓ 로 훑을 수 있다.
 * 확정은 Enter·포커스 아웃·목록 선택 시에 일어나고, 해석할 수 없는 입력은 원래 값으로 되돌린다.
 */
function SnapshotCombo({ side, tag, label, value, choices, onCommit, disabled }: ComboProps) {
  const [draft, setDraft] = useState(value)
  const [typing, setTyping] = useState(false)

  // 바깥에서 값이 바뀌면(자동 보정 포함) 입력창도 따라간다
  useEffect(() => {
    setDraft(value)
    setTyping(false)
  }, [value])

  // 타이핑 중이면서 해석되지 않는 상태만 오류로 본다 (빈 칸은 아직 오류가 아니다)
  const unresolved = typing && draft.trim() !== '' && !resolveSnapshotInput(choices, draft)

  /** 해석되면 확정하고, 안 되면 마지막 확정값으로 되돌린다 */
  const commit = (): void => {
    const hit = resolveSnapshotInput(choices, draft)
    setTyping(false)
    // 표기가 달라도(`20260801` → `2026-08-01`) 항상 실제 폴더명으로 맞춘다
    setDraft(hit ? hit.id : value)
    if (hit && hit.id !== value) onCommit(hit.id)
  }

  const change = (next: string): void => {
    setDraft(next)
    setTyping(true)
    // 목록에서 골랐거나 폴더명을 끝까지 친 경우 — 기다리지 않고 바로 반영한다
    const exact = choices.find((s) => s.id === next)
    if (exact) {
      setTyping(false)
      if (exact.id !== value) onCommit(exact.id)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      e.currentTarget.blur()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(value)
      setTyping(false)
    }
  }

  const listId = `snapshot-choices-${side}`

  return (
    <div className={`pick ${side}${unresolved ? ' invalid' : ''}`}>
      {tag}
      <input
        type="text"
        list={listId}
        value={draft}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        onFocus={(e) => e.currentTarget.select()}
        disabled={disabled}
        placeholder={disabled ? '— 없음 —' : '날짜 입력'}
        aria-label={label}
        aria-invalid={unresolved}
        autoComplete="off"
        spellCheck={false}
      />
      <datalist id={listId}>
        {choices.map((s) => (
          <option key={s.id} value={s.id}>
            {hint(s)}
          </option>
        ))}
      </datalist>
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
}

interface SnapshotPickerProps {
  left: PickerSide
  right: PickerSide
  /** 환경 선택지. 비어 있으면 환경 고르는 자리가 아예 없다 (`change/config.ts` 의 `ENV_FOLDERS`) */
  envChoices: EnvFolder[]
  /** 좌우가 같은 곳을 보는지 — 날짜 후보와 순서 규칙이 여기서 갈린다 */
  sameSource: boolean
  onChangeSnapshot: (side: Side, id: string) => void
  onChangeEnv: (side: Side, envId: string) => void
  /** 환경을 좌우 함께 바꾸는 중인지 */
  envLinked: boolean
  onToggleEnvLink: () => void
  onRefresh: () => void
  /** 스냅샷 목록 자체를 다시 읽는 중 — 비교 중에는 입력을 막지 않는다 */
  loading: boolean
}

/**
 * 비교할 두 곳을 고른다 — **좌우가 각각 (환경, 날짜)** 를 고른다.
 *
 * 환경이 같으면 예전 그대로 `이후` 후보에 `이전` 보다 최신인 날짜만 담긴다.
 * 환경이 다르면 그 규칙을 걸지 않는다 — 운영 9/1 과 테스트 8/15 는 거꾸로 된 비교가
 * 아니라 "테스트가 뒤처져 있다" 는 정상적인 질문이다.
 */
export default function SnapshotPicker({
  left,
  right,
  envChoices,
  sameSource,
  onChangeSnapshot,
  onChangeEnv,
  envLinked,
  onToggleEnvLink,
  onRefresh,
  loading,
}: SnapshotPickerProps) {
  // 같은 곳이면 두 날짜가 필요하고, 다른 곳이면 각자 하나씩 있으면 된다
  const comparable = sameSource
    ? left.snapshots.length >= 2
    : left.snapshots.length > 0 && right.snapshots.length > 0
  const disabled = !comparable || loading

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

  return (
    <div className="snapshot-picker">
      <SnapshotCombo
        side="left"
        tag={tagFor('left', left)}
        label="기준 날짜"
        value={left.value}
        choices={leftChoices(left.snapshots, sameSource)}
        onCommit={(id) => onChangeSnapshot('left', id)}
        disabled={disabled}
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
        onCommit={(id) => onChangeSnapshot('right', id)}
        disabled={disabled}
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
        ⟳ 새로고침
      </button>
    </div>
  )
}
