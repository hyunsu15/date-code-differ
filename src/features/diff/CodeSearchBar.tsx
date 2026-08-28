import { useEffect, useRef, type KeyboardEvent } from 'react'
import { MAX_MATCHES } from '../../lib/search.ts'
import type { SearchOptions, SearchResult } from '../../types.ts'

interface CodeSearchBarProps {
  options: SearchOptions
  result: SearchResult
  /** 현재 선택된 결과 index (결과가 없으면 -1) */
  index: number
  onChange: (next: SearchOptions) => void
  onStep: (delta: number) => void
  onClose: () => void
}

/** diff 코드 안에서 찾기 — 오른쪽 위에 떠 있는 위젯 (Ctrl+F) */
export default function CodeSearchBar({
  options,
  result,
  index,
  onChange,
  onStep,
  onClose,
}: CodeSearchBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const total = result.matches.length
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onStep(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="code-search" role="search">
      <span className="cs-icon">🔍</span>
      <input
        ref={inputRef}
        className="cs-input"
        value={options.query}
        placeholder="코드에서 찾기"
        spellCheck={false}
        onChange={(e) => onChange({ ...options, query: e.target.value })}
        onKeyDown={onKeyDown}
      />

      <button
        className={`cs-opt ${options.caseSensitive ? 'on' : ''}`}
        title="대소문자 구분"
        aria-pressed={options.caseSensitive}
        onClick={() => onChange({ ...options, caseSensitive: !options.caseSensitive })}
      >
        Aa
      </button>
      <button
        className={`cs-opt ${options.regex ? 'on' : ''}`}
        title="정규식으로 찾기"
        aria-pressed={options.regex}
        onClick={() => onChange({ ...options, regex: !options.regex })}
      >
        .*
      </button>

      <span className={`cs-count ${result.error ? 'err' : ''}`}>
        {result.error
          ? '정규식 오류'
          : !options.query
            ? ''
            : total === 0
              ? '결과 없음'
              : `${index + 1} / ${total}${result.truncated ? '+' : ''}`}
      </span>

      <button className="cs-nav" title="이전 (Shift+Enter)" disabled={total === 0} onClick={() => onStep(-1)}>
        ↑
      </button>
      <button className="cs-nav" title="다음 (Enter)" disabled={total === 0} onClick={() => onStep(1)}>
        ↓
      </button>
      <button className="cs-nav" title="닫기 (Esc)" onClick={onClose}>
        ✕
      </button>

      {result.truncated && (
        <span className="cs-note">결과가 {MAX_MATCHES.toLocaleString('ko-KR')}개를 넘어 일부만 표시합니다</span>
      )}
    </div>
  )
}
