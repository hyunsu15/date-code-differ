/** 유사도(0~1)에 대응하는 색 */
export function simColor(v: number): string {
  if (v >= 0.9) return 'var(--add-fg)'
  if (v >= 0.7) return 'var(--accent)'
  if (v >= 0.4) return 'var(--mod-fg)'
  return 'var(--del-fg)'
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/')
  return i === -1 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
}

export const num = (n: number | null | undefined): string => (n ?? 0).toLocaleString('ko-KR')

/**
 * 받침에 맞는 조사를 고른다 — `이/가`, `은/는`, `을/를`.
 *
 * 화면 문구를 이름으로 조립하면 "인덱스이 없습니다" 같은 말이 나온다.
 * 종류 이름이 설정이나 데이터에서 오는 자리에서는 사람이 미리 손볼 수가 없어
 * 여기서 가린다.
 *
 * @param withFinal    받침이 있을 때 (`이` · `은` · `을`)
 * @param withoutFinal 받침이 없을 때 (`가` · `는` · `를`)
 */
export function particle(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  // 한글 음절이 아니면(영문·숫자·기호) 받침 여부를 알 수 없다 — 받침 있는 쪽으로 둔다
  if (!Number.isFinite(code) || code < 0xac00 || code > 0xd7a3) return withFinal
  return (code - 0xac00) % 28 === 0 ? withoutFinal : withFinal
}
