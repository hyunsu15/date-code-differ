import { useEffect, useState, type KeyboardEvent } from 'react'
import { leftChoices, resolveSnapshotInput, rightChoices } from './selection.ts'
import type { Side, Snapshot } from '../../types.ts'

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
  tag: string
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
function SnapshotCombo({ side, tag, value, choices, onCommit, disabled }: ComboProps) {
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
      <span className="side-tag">{tag}</span>
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
        aria-label={`${tag} 스냅샷`}
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

interface SnapshotPickerProps {
  snapshots: Snapshot[]
  left: string
  right: string
  onChange: (side: Side, id: string) => void
  onRefresh: () => void
  /** 스냅샷 목록 자체를 다시 읽는 중 — 비교 중에는 입력을 막지 않는다 */
  loading: boolean
}

/**
 * 비교할 두 날짜 폴더를 고른다.
 * `이후` 후보에는 `이전` 보다 최신인 날짜만 담긴다 — 거꾸로 된 비교는 아예 만들어지지 않는다.
 */
export default function SnapshotPicker({
  snapshots,
  left,
  right,
  onChange,
  onRefresh,
  loading,
}: SnapshotPickerProps) {
  const comparable = snapshots.length >= 2
  const disabled = !comparable || loading

  return (
    <div className="snapshot-picker">
      <SnapshotCombo
        side="left"
        tag="이전"
        value={left}
        choices={leftChoices(snapshots)}
        onCommit={(id) => onChange('left', id)}
        disabled={disabled}
      />

      <span className="pick-arrow" aria-hidden="true">
        →
      </span>

      <SnapshotCombo
        side="right"
        tag="이후"
        value={right}
        choices={rightChoices(snapshots, left)}
        onCommit={(id) => onChange('right', id)}
        disabled={disabled}
      />

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
