/**
 * 비교에서 **접어 둘** 파일 목록.
 *
 * 목록은 코드가 아니라 **텍스트 파일**에 있다 (`change/config.ts` 의 프리셋에서 경로를
 * 지정한다). 소스와 같은 자리에 두면 팀이 함께 고칠 수 있고, 도구를 다시 배포하지 않아도
 * 규칙이 바뀐다 — 자동생성물·벤더 코드처럼 "누가 봐도 볼 필요 없는" 것이 대상이라
 * 사람마다 다른 값이 아니다.
 *
 * **거르는 게 아니라 접는 것이다.** 걸린 파일도 비교는 그대로 하고 목록에서만 접어 둔다.
 * 운영과 테스트의 차이를 확인하려고 여는 도구에서 "안 보이는 파일"을 만들면, 제외해 둔
 * 곳에 진짜 변경이 들어와도 아무도 모른 채 지나간다. 그래서 화면은 늘 "제외 N개"를 남기고,
 * 그중 바뀐 것이 있으면 따로 알린다 (`ExcludeInfo.changed`).
 *
 * 서버(`server/*`)와 화면(`src/*`)이 같은 기준을 쓰도록 여기 한 곳에만 둔다.
 */

/**
 * 항목을 가르는 기본 구분자.
 *
 * 쉼표만으로는 부족하다 — txt 파일을 열면 사람은 대개 **한 줄에 하나씩** 적는다.
 * 둘 다 받아 두면 어느 쪽으로 적어도 통하고, 섞여 있어도 된다.
 * `change/config.ts` 의 `SCAN.excludeSeparators` 로 바꿀 수 있다.
 */
export const DEFAULT_EXCLUDE_SEPARATORS: readonly string[] = [',', '\n']

/** 이 글자로 시작하는 항목은 설명이다 — 왜 제외했는지 적어 둘 자리 */
const COMMENT = '#'

/** 메모장이 붙이는 BOM. 첫 항목 앞에 남으면 그 규칙만 조용히 안 먹는다 */
const BOM = '﻿'

/** 정규식에서 뜻을 갖는 글자들. 글로브의 `*` `?` 는 따로 다루므로 여기 없다 */
const REGEX_META = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])

const escapeChar = (ch: string): string => (REGEX_META.has(ch) ? `\\${ch}` : ch)

const escapeAll = (value: string): string => [...value].map(escapeChar).join('')

/** 규칙 하나 — 원문은 화면에 "왜 접혔는지" 를 보여주기 위해 남긴다 */
interface ExcludeRule {
  /** 파일에 적힌 그대로 */
  source: string
  test: RegExp
}

/**
 * 경로를 비교 가능한 모양으로 맞춘다.
 * 윈도우에서 적은 역슬래시와 앞머리 `./` · `/` 는 뜻이 같으므로 한 형태로 모은다.
 */
function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

/**
 * 규칙 원문을 매칭용 패턴으로 바꾼다.
 *
 * **슬래시가 없으면 이름만 보고 건다** (`*_bak.pc` 는 어느 폴더에 있든 걸린다).
 * 슬래시가 있으면 루트부터 맞춘다 (`ord/tmp` 는 그 자리의 tmp 만).
 * `.gitignore` 와 같은 규칙이라 따로 익힐 것이 없다.
 */
function toPattern(raw: string): string {
  const cleaned = normalizePath(raw)
  if (!cleaned) return ''
  return cleaned.includes('/') ? cleaned : `**/${cleaned}`
}

/**
 * 글로브를 정규식으로 바꾼다. **정규식은 규칙 파일에서 받지 않는다** —
 * 사용자가 직접 고치는 값이라, 잘못 적은 한 줄이 목록을 통째로 비우거나
 * 되돌아오지 않는 검색이 되는 길을 열어 둘 이유가 없다.
 *
 *   `*`   한 폴더 안의 아무 글자 (`/` 는 넘지 않는다)
 *   `**`  폴더 경계를 넘는 아무 글자
 *   `?`   아무 한 글자
 *
 * 별 두 개 뒤에 `/` 가 오면 **0단도 포함**해 건너뛴다. 이름만 적은 규칙은
 * `toPattern` 이 앞에 그 형태를 붙이므로, 루트에 바로 놓인 파일도 걸려야 한다.
 *
 * 끝에 `(?:/.*)?` 를 붙여 **폴더 이름으로 적으면 그 아래 전부**가 걸리게 한다
 * (`ord` 한 줄로 `ord/ord_create.pc` 까지).
 *
 * 대소문자는 가리지 않는다. 파일 이름의 대소문자는 로컬(윈도우)과 원격(UNIX)에서
 * 다르게 다뤄져, 가리기 시작하면 같은 규칙이 한쪽에서만 먹는다.
 */
function toRegExp(pattern: string): RegExp {
  let body = ''
  let i = 0

  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch !== '*') {
      body += ch === '?' ? '[^/]' : escapeChar(ch)
      i += 1
      continue
    }
    if (pattern[i + 1] !== '*') {
      body += '[^/]*'
      i += 1
      continue
    }
    const withSlash = pattern[i + 2] === '/'
    body += withSlash ? '(?:.*/)?' : '.*'
    i += withSlash ? 3 : 2
  }

  return new RegExp(`^${body}(?:/.*)?$`, 'i')
}

/** 구분자 목록을 쪼개기용 정규식으로. 쓸 수 있는 것이 없으면 기본값으로 돌아간다 */
function splitter(separators: readonly string[]): RegExp {
  const usable = separators.filter((s) => s.length > 0)
  const chosen = usable.length > 0 ? usable : DEFAULT_EXCLUDE_SEPARATORS
  return new RegExp(chosen.map(escapeAll).join('|'))
}

/**
 * 제외 규칙 묶음.
 *
 * 규칙은 한 번 읽으면 바뀌지 않고, 서버와 화면이 **같은 판정**을 내려야 한다.
 * 그래서 배열을 그대로 돌리지 않고 "걸리는지 묻는" 창구만 연다.
 */
export class ExcludeList {
  private readonly rules: readonly ExcludeRule[]

  private constructor(rules: readonly ExcludeRule[]) {
    this.rules = [...rules]
  }

  /** 규칙이 하나도 없는 상태 — 파일을 안 쓰거나 못 읽었을 때 */
  static readonly EMPTY = new ExcludeList([])

  /**
   * 규칙 파일의 본문을 읽어 들인다.
   *
   * 빈 항목·설명(`#`)·중복은 버린다. 잘못 적은 한 줄 때문에 나머지가 날아가지 않도록
   * **항목마다 따로** 본다 (무시 옵션 저장값을 다루는 방식과 같다).
   */
  static parse(
    raw: string | null,
    separators: readonly string[] = DEFAULT_EXCLUDE_SEPARATORS
  ): ExcludeList {
    if (!raw) return ExcludeList.EMPTY

    const rules: ExcludeRule[] = []
    const seen = new Set<string>()

    for (const piece of raw.replace(BOM, '').split(splitter(separators))) {
      const source = piece.trim()
      const pattern = source.startsWith(COMMENT) ? '' : toPattern(source)
      if (!pattern || seen.has(pattern)) continue

      seen.add(pattern)
      rules.push({ source, test: toRegExp(pattern) })
    }

    return rules.length === 0 ? ExcludeList.EMPTY : new ExcludeList(rules)
  }

  get size(): number {
    return this.rules.length
  }

  get isEmpty(): boolean {
    return this.rules.length === 0
  }

  /** 화면·로그에 보여줄 규칙 원문들 */
  get patterns(): readonly string[] {
    return this.rules.map((r) => r.source)
  }

  /**
   * 이 경로를 접어야 하는지.
   * @returns 걸린 규칙의 **원문** (화면이 "왜 접혔는지" 를 보여준다). 안 걸리면 null
   */
  matches(relPath: string): string | null {
    const target = normalizePath(relPath)
    if (!target) return null
    return this.rules.find((rule) => rule.test.test(target))?.source ?? null
  }
}
