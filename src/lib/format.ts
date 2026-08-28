/** 유사도(0~1)에 대응하는 색 */
export function simColor(v: number): string {
  if (v >= 0.9) return 'var(--add-fg)'
  if (v >= 0.7) return 'var(--accent)'
  if (v >= 0.4) return '#d29922'
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
