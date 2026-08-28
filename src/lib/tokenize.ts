/**
 * 코드용 토크나이저.
 * 식별자 / 숫자 / 공백덩어리 / 그 외 문자 1개 단위로 잘라서
 * 단어 단위(intra-line) diff 의 입력으로 쓴다.
 * `foo(bar)` 가 통째로 한 덩어리가 되는 걸 막기 위해 공백 기준 분할을 쓰지 않는다.
 */
const TOKEN_RE = /[A-Za-z_$À-￿][A-Za-z0-9_$À-￿]*|\d+(?:\.\d+)?|[ \t]+|[\s\S]/g

export function tokenizeCode(line: string): string[] {
  if (!line) return []
  return line.match(TOKEN_RE) ?? []
}

/** 줄바꿈 정규화 후 라인 배열로 분리 */
export function splitLines(text: string | null | undefined): string[] {
  if (text == null) return []
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  if (normalized === '') return []
  return normalized.split('\n')
}
