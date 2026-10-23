import { useEffect, useRef, useState } from 'react'
import FontSize from './FontSize.tsx'
import type { DiffOptions } from '../../types.ts'

/** 무시 옵션 — 이름 옆에 한 줄 설명을 늘 붙인다 (툴팁은 마우스를 올려야만 보여 처음 온 사람이 못 본다) */
const IGNORE_ITEMS: { key: keyof DiffOptions; label: string; desc: string }[] = [
  { key: 'ignoreWhitespace', label: '공백', desc: '들여쓰기·공백 개수 차이를 같은 줄로 봅니다' },
  { key: 'ignoreCase', label: '대소문자', desc: 'Total 과 total 을 같은 줄로 봅니다' },
  { key: 'ignoreBlankLines', label: '빈 줄', desc: '빈 줄이 늘거나 준 것은 비교에서 뺍니다' },
  { key: 'ignoreComments', label: '주석', desc: '주석만 있는 줄은 비교에서 뺍니다' },
  {
    key: 'ignoreAuthor',
    label: '작성자',
    desc: '작성자 : 홍길동 처럼 이름을 적어 둔 줄을 뺍니다 (수정자 · 변경자 · @author 도)',
  },
  {
    key: 'ignoreDeadCode',
    label: '죽은 코드',
    desc: '#if 0 … #endif 처럼 실행되지 않는 블록을 뺍니다 (#ifdef 는 그대로 비교)',
  },
]

interface ViewOptionsProps {
  options: DiffOptions
  onChangeOptions: (next: DiffOptions) => void
  wrap: boolean
  onChangeWrap: (next: boolean) => void
  fontSize: number
  onChangeFontSize: (next: number) => void
}

/**
 * 보기 옵션 — 무시 6종 · 줄바꿈 · 글자 크기를 한 버튼 아래로 모은다.
 *
 * 옵션 바에 전부 펼쳐 두면 1024px 에서 두 줄이 되어 코드가 그만큼 아래로 밀렸다.
 * 한 번 정하면 잘 안 바꾸는 값들이라 접어 두고, **몇 개를 무시하고 있는지는 버튼에 늘 보인다**
 * — 무시 옵션은 결과를 바꾸므로 켜져 있는 걸 모른 채 보면 안 된다.
 */
export default function ViewOptions({
  options,
  onChangeOptions,
  wrap,
  onChangeWrap,
  fontSize,
  onChangeFontSize,
}: ViewOptionsProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const ignored = IGNORE_ITEMS.filter((item) => options[item.key]).length

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="view-options" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`btn sm${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        보기 옵션
        <span className="vo-count">무시 {ignored}</span>
        {open ? '▴' : '▾'}
      </button>

      {open && (
        <div className="vo-panel" role="dialog" aria-label="보기 옵션">
          <div className="vo-title">비교에서 무시</div>
          {IGNORE_ITEMS.map((item) => (
            <label key={item.key} className="vo-item">
              <input
                type="checkbox"
                checked={options[item.key]}
                onChange={(e) => onChangeOptions({ ...options, [item.key]: e.target.checked })}
              />
              <span className="vo-text">
                <b>{item.label}</b>
                <small>{item.desc}</small>
              </span>
            </label>
          ))}

          <div className="vo-title">표시</div>
          <label className="vo-item">
            <input type="checkbox" checked={wrap} onChange={(e) => onChangeWrap(e.target.checked)} />
            <span className="vo-text">
              <b>줄바꿈</b>
              <small>긴 줄을 화면 폭에 맞춰 접습니다</small>
            </span>
          </label>
          <div className="vo-font">
            <FontSize value={fontSize} onChange={onChangeFontSize} />
          </div>
        </div>
      )}
    </div>
  )
}
