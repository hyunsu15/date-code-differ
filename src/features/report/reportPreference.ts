import type { ReportKind } from './report.ts'

/**
 * 본 버튼이 받을 보고서 — **마지막으로 고른 것을 기억한다.** 처음은 통합.
 *
 * 통합을 가장 많이 받는다. 그렇다고 통합으로 못 박으면 스키마만 공지하는 사람은 매번 ▾ 를
 * 눌러야 하고, 지금 탭을 따라가게 두면 통합을 받으려고 매번 ▾ 를 눌러야 했다.
 * 메뉴에서 고르면 그게 본 버튼이 된다(GitHub 병합 버튼과 같은 방식) — 글자가 늘 무엇을
 * 받는지 말해 주니 바뀌어도 헷갈리지 않는다. 이 브라우저에만 남는다.
 */

const STORAGE_KEY = 'cd-report-kind'

export const DEFAULT_REPORT_KIND: ReportKind = 'all'

const KINDS: readonly ReportKind[] = ['all', 'code', 'schema']

/** 모르는 값·빈 값은 통합으로 */
export const parseReportKind = (raw: string | null): ReportKind =>
  KINDS.find((k) => k === raw) ?? DEFAULT_REPORT_KIND

export function loadReportKind(): ReportKind {
  try {
    return parseReportKind(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_REPORT_KIND
  }
}

export function saveReportKind(kind: ReportKind): void {
  try {
    localStorage.setItem(STORAGE_KEY, kind)
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}

/**
 * 본 버튼이 실제로 받을 것.
 *
 * 스키마 위치가 설정돼 있지 않으면 통합·스키마는 영영 못 받는다 — 그때는 잠긴 버튼을 두지 말고
 * 소스로 내려 준다. 비교 중이라 잠깐 못 받는 것은 그대로 둔다(곧 풀린다).
 */
export const primaryKind = (chosen: ReportKind, schemaConfigured: boolean): ReportKind =>
  schemaConfigured ? chosen : 'code'
