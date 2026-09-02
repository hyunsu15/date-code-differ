/**
 * 코드·스키마 글자 크기 조절.
 *
 * 두 화면이 **같은 값을 나눠 쓴다.** 크기는 "내 눈에 맞는 정도" 라 화면마다 따로
 * 기억할 이유가 없고, 탭을 옮길 때마다 글자가 커졌다 작아지면 그게 더 거슬린다.
 * 실제 적용은 `--code-size` · `--code-lh` 두 변수로 하므로 여기서는 값만 다룬다.
 */

export const FONT_MIN = 10
export const FONT_MAX = 22
export const FONT_DEFAULT = 12.5
export const FONT_STEP = 0.5

/** 저장된 값을 읽는다. 범위를 벗어난 값은 기본으로 되돌린다 */
export function readFontSize(): number {
  const raw = Number(localStorage.getItem('cd-code-font'))
  if (!Number.isFinite(raw) || raw < FONT_MIN || raw > FONT_MAX) return FONT_DEFAULT
  return raw
}

interface FontSizeProps {
  value: number
  onChange: (next: number) => void
}

export default function FontSize({ value, onChange }: FontSizeProps) {
  return (
    <div className="group">
      <span className="label">글자</span>
      <div className="btn-group">
        <button
          type="button"
          className="btn sm"
          onClick={() => onChange(Math.max(FONT_MIN, value - FONT_STEP))}
          disabled={value <= FONT_MIN}
          title="글자 작게"
          aria-label="글자 작게"
        >
          가−
        </button>
        <button
          type="button"
          className="btn sm font-size"
          onClick={() => onChange(FONT_DEFAULT)}
          disabled={value === FONT_DEFAULT}
          title="기본 크기로 되돌리기"
        >
          {value}px
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => onChange(Math.min(FONT_MAX, value + FONT_STEP))}
          disabled={value >= FONT_MAX}
          title="글자 크게"
          aria-label="글자 크게"
        >
          가+
        </button>
      </div>
    </div>
  )
}
