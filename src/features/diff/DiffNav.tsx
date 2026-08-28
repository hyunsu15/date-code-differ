import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Hunk } from '../../types.ts'

interface DiffNavProps {
  hunks: Hunk[]
  /** diff 표시가 꺼져 있으면 이동할 지점 자체가 없다 */
  diffEnabled: boolean
  current: number
  /** 절대 위치 이동 */
  onGo: (index: number, scroll: boolean) => void
  /** 상대 이동 (연타 안전) */
  onStep: (delta: number) => void
  onPrevFile: () => void
  onNextFile: () => void
  onOpenSearch: () => void
  /** 선택된 파일 경로 — 바뀌면 열려 있던 목록 패널을 닫는다 */
  fileKey: string
}

/**
 * diff 포인트 네비게이션
 *  - 이전 / 다음 이동
 *  - 번호 입력으로 특정 포인트 이동
 *  - 목록에서 골라 이동
 */
export default function DiffNav({
  hunks,
  diffEnabled,
  current,
  onGo,
  onStep,
  onPrevFile,
  onNextFile,
  onOpenSearch,
  fileKey,
}: DiffNavProps) {
  const [open, setOpen] = useState(false)
  const [jumpValue, setJumpValue] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const count = hunks.length

  useEffect(() => setOpen(false), [fileKey])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null
      if (!panelRef.current?.contains(target) && !target?.closest('[data-jump-toggle]')) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const go = (i: number): void => {
    if (!count) return
    onGo(Math.max(0, Math.min(count - 1, i)), true)
  }

  const submitJump = (e: FormEvent): void => {
    e.preventDefault()
    const n = parseInt(jumpValue, 10)
    if (!Number.isNaN(n)) go(n - 1)
    setJumpValue('')
  }

  return (
    <div className="navbar">
      <span className="label" style={{ color: 'var(--faint)', fontSize: 11 }}>
        DIFF 포인트
      </span>

      <div className="btn-group">
        <button className="btn sm" onClick={() => onStep(-1)} disabled={!count || current <= 0} title="이전 diff (p)">
          ↑ 이전
        </button>
        <button
          className="btn sm"
          onClick={() => onStep(1)}
          disabled={!count || current >= count - 1}
          title="다음 diff (n)"
        >
          다음 ↓
        </button>
      </div>

      <span className="nav-counter">
        {!diffEnabled ? (
          <span style={{ fontSize: 11 }}>diff 꺼짐</span>
        ) : count ? (
          <>
            <b>{current + 1}</b> / {count}
          </>
        ) : (
          '차이 없음'
        )}
      </span>

      <div className="btn-group">
        <button className="btn sm" onClick={() => go(0)} disabled={!count} title="첫 diff">
          ⇤ 처음
        </button>
        <button className="btn sm" onClick={() => go(count - 1)} disabled={!count} title="마지막 diff">
          마지막 ⇥
        </button>
      </div>

      <form onSubmit={submitJump} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          className="jump-input"
          type="number"
          min="1"
          max={count || 1}
          placeholder="번호"
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          disabled={!count}
          title="번호를 입력하고 Enter"
        />
        <button className="btn sm" type="submit" disabled={!count || jumpValue === ''}>
          이동
        </button>
      </form>

      <button className="btn sm" data-jump-toggle onClick={() => setOpen((v) => !v)} disabled={!count}>
        목록에서 선택 {open ? '▴' : '▾'}
      </button>

      <div style={{ flex: 1 }} />

      <button className="btn sm" onClick={onOpenSearch} title="코드에서 찾기 (Ctrl+F)">
        🔍 코드 검색
      </button>

      <div className="btn-group">
        <button className="btn sm" onClick={onPrevFile} title="이전 파일 ([)">
          ◀ 파일
        </button>
        <button className="btn sm" onClick={onNextFile} title="다음 파일 (])">
          파일 ▶
        </button>
      </div>

      {open && (
        <div className="jump-panel" ref={panelRef}>
          {hunks.map((h) => (
            <button
              key={h.index}
              className={`jump-item ${h.index === current ? 'active' : ''}`}
              onClick={() => {
                go(h.index)
                setOpen(false)
              }}
            >
              <span className="n">{h.index + 1}</span>
              <span className="loc">
                이전 {h.aStart ?? '-'} / 이후 {h.bStart ?? '-'}
              </span>
              <span className="prev">{h.preview || '(빈 줄)'}</span>
              <span className="cnt">
                {h.mod > 0 && <span style={{ color: '#d29922' }}>~{h.mod} </span>}
                {h.add > 0 && <span style={{ color: 'var(--add-fg)' }}>+{h.add} </span>}
                {h.del > 0 && <span style={{ color: 'var(--del-fg)' }}>−{h.del}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
