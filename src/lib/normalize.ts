import type { DiffOptions } from '../types.ts'

/**
 * 비교 옵션에 따라 라인을 "비교용 키"로 정규화하고, 비교에서 아예 뺄 줄을 가려낸다.
 * 정규화된 키가 같으면 두 라인은 동일한 것으로 간주된다.
 * 화면에는 항상 원본 라인이 그대로 표시된다.
 */

export const DEFAULT_OPTIONS: DiffOptions = {
  ignoreWhitespace: false,
  ignoreCase: false,
  ignoreBlankLines: false,
  ignoreComments: false,
}

export function normalizeLine(line: string, opts: DiffOptions): string {
  let s = line
  if (opts.ignoreWhitespace) s = s.replace(/\s+/g, ' ').trim()
  if (opts.ignoreCase) s = s.toLowerCase()
  return s
}

/* ------------------------------------------------------------------
   주석 걷어내기
   ------------------------------------------------------------------ */

// 줄 하나만 봐서는 주석인지 알 수 없다. 아래 가운데 줄은 그 자체로는 그냥 글자라,
// 파일을 위에서부터 훑으며 "지금 블록 주석 안인지" 를 들고 가야 한다.
//
//     /*****
//      주석값       ← 이 줄
//      *****/
//
// 대상은 Pro*C(.pc) 와 Oracle 패키지(.pks/.pkb) 다. 두 언어의 주석은 셋뿐이다:
// 블록(`/*` … `*/`) · C 한 줄(`//`) · SQL 한 줄(`--`).
// `#` 은 주석이 아니라 전처리기 지시자(`#include`)고, `;` 는 문장 끝이다 —
// 주석으로 보면 `#include` 한 줄이 통째로 비교에서 빠진다.

/** 줄을 넘어가며 이어지는 상태 — 여러 줄 주석은 이것으로만 알 수 있다 */
interface BlockState {
  inBlock: boolean
}

/** SQL 한 줄 주석(`--`) 과 C 의 감소 연산자(`--i`) 를 가르는 기준 */
const IDENT_CHAR = /[A-Za-z0-9_]/

/**
 * 한 줄에서 주석을 걷어내고 **남은 코드**를 돌려준다.
 *
 * 문자열 리터럴 안은 건너뛴다 — `strcpy(buf, "/*")` 의 `/*` 는 주석이 아니다.
 * 따옴표 상태는 줄마다 새로 시작한다. C 문자열은 줄을 넘지 않으므로
 * (넘기려면 줄 끝에 `\` 가 있어야 한다) 한 줄에서 안 닫힌 따옴표를 다음 줄까지
 * 끌고 가면 오히려 뒤가 전부 문자열로 물든다.
 */
function stripComments(line: string, state: BlockState): string {
  let code = ''
  let i = 0
  /** 지금 열려 있는 따옴표. 없으면 빈 문자열 */
  let quote = ''

  while (i < line.length) {
    const ch = line[i]
    const next = line[i + 1] ?? ''

    if (state.inBlock) {
      if (ch === '*' && next === '/') {
        state.inBlock = false
        i += 2
      } else i++
      continue
    }

    if (quote) {
      code += ch
      if (ch === '\\') {
        code += next
        i += 2
        continue
      }
      if (ch === quote) quote = ''
      i++
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      code += ch
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      state.inBlock = true
      i += 2
      continue
    }
    if (ch === '/' && next === '/') break
    // `--` 는 SQL 주석이지만 C 의 감소 연산자이기도 하다. 바로 뒤에 영숫자가 붙으면
    // (`--i;`) 연산자로 본다 — 놓친 주석은 한 줄 더 보일 뿐이지만, 코드를 주석으로
    // 잘못 보면 진짜 차이가 비교에서 사라진다. 한글 주석(`--설명`)은 그대로 잡힌다.
    if (ch === '-' && next === '-' && !IDENT_CHAR.test(line[i + 2] ?? '')) break

    code += ch
    i++
  }

  return code
}

/**
 * 파일 전체를 훑어 **비교에서 뺄 줄**을 표시한다.
 *
 * 줄 하나만 보고 결정할 수 없어(여러 줄 주석) 파일 단위로 판정한다.
 * 뺀 줄도 화면에는 `ignored` 행으로 그대로 남는다 — 통계에서만 빠진다.
 */
export function markDroppedLines(lines: readonly string[], opts: DiffOptions): boolean[] {
  const out = new Array<boolean>(lines.length).fill(false)
  if (!opts.ignoreBlankLines && !opts.ignoreComments) return out

  const state: BlockState = { inBlock: false }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const blank = line.trim() === ''

    let comment = false
    if (opts.ignoreComments) {
      const startedInBlock = state.inBlock
      const code = stripComments(line, state)
      // 주석을 걷어내고 아무것도 안 남았을 때만 주석 줄이다.
      // 블록 안에서 시작한 줄은 빈 줄이어도 주석의 일부고(`startedInBlock`),
      // 블록이 줄 중간에서 닫히고 코드가 이어지면(`*/ x = 1;`) 주석 줄이 아니다.
      comment = code.trim() === '' && (startedInBlock || !blank)
    }

    out[i] = comment || (opts.ignoreBlankLines && blank)
  }

  return out
}
