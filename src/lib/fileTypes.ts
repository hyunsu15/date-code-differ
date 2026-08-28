/**
 * 비교 대상 파일·폴더 판별 규칙.
 * 서버(server/*)와 화면(src/*)이 같은 기준을 쓰도록 여기 한 곳에만 둔다.
 */

/**
 * 기본 비교 대상 확장자.
 * `change/config.ts` 의 `SCAN.extensions` 로 덮어쓸 수 있다.
 *   pc  = Pro*C 소스, pch = Pro*C 헤더
 *   pks = Oracle 패키지 명세, pkb = Oracle 패키지 본문
 */
export const DEFAULT_EXTENSIONS = ['pc', 'pch', 'h', 'sql', 'pks', 'pkb'] as const

/** 쉼표 구분 문자열을 확장자 집합으로 바꾼다. 비어 있으면 기본값을 쓴다. */
export function parseExtensions(raw: string | undefined | null): ReadonlySet<string> {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean)
  return new Set<string>(list.length ? list : DEFAULT_EXTENSIONS)
}

export function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path
  const i = base.lastIndexOf('.')
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase()
}

export function hasComparableExt(path: string, allowed: ReadonlySet<string>): boolean {
  const ext = extensionOf(path)
  return ext !== '' && allowed.has(ext)
}

/** 훑을 때 건너뛰는 디렉터리 */
export const SKIP_DIR_RE =
  /(^|\/)(node_modules|\.git|\.svn|\.idea|\.vscode|dist|build|out|target|bin|obj|coverage|__pycache__)(\/|$)/

/**
 * 날짜 폴더명에서 정렬용 키(YYYYMMDD)를 뽑는다.
 * 이름 어디에 있든 **처음 나오는 유효한 날짜**를 쓰므로 아래가 모두 `20260801` 이 된다.
 *
 *   20260801 · 2026-08-01 · 2026.08.01 · 2026_08_01
 *   rel_20260801 · v2_20260801 · build-3-2026-08-01 · 20260801-hotfix
 *
 * 날짜로 볼 수 없으면 빈 문자열 — 호출부가 폴더명 자체로 정렬하도록 한다.
 */
export function snapshotSortKey(folderName: string): string {
  // 구분자(`-` `.` `_`)는 있어도 없어도 된다. 모듈 전역에 두면 lastIndex 가 남아
  // 다음 호출에 영향을 주므로 호출마다 새로 만든다.
  const re = /(\d{4})\D?(\d{2})\D?(\d{2})/g

  let m: RegExpExecArray | null
  while ((m = re.exec(folderName)) !== null) {
    const [, year, month, day] = m
    const mo = Number(month)
    const d = Number(day)
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${year}${month}${day}`
    // 앞에 다른 숫자가 붙어 자릿수가 밀린 경우(`v2_20260801`)를 위해
    // 한 글자씩 밀며 다시 본다. lastIndex 를 그대로 두면 뒤를 통째로 건너뛴다.
    re.lastIndex = m.index + 1
  }
  return ''
}

/**
 * 외부 폴더 안에서만 쓸 수 있는 안전한 상대 경로인지 검사한다.
 * 상위 경로 탈출(`..`)과 절대 경로를 막는다.
 * @returns 정규화된 상대 경로, 부적합하면 null
 */
export function safeRelativePath(raw: string): string | null {
  const cleaned = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!cleaned) return null
  if (cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) return null
  const segments = cleaned.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null
  return cleaned
}

/**
 * 날짜 폴더 기준 상대 경로에서 패키지명을 뽑는다.
 * 바로 아래 디렉터리가 패키지이고, 날짜 폴더에 바로 놓인 파일은 `(루트)` 로 묶는다.
 */
export const ROOT_PACKAGE = '(루트)'

export function packageOf(relPath: string): string {
  const i = relPath.indexOf('/')
  return i === -1 ? ROOT_PACKAGE : relPath.slice(0, i)
}
