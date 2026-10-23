import { changeLegend, schemaChangeRows, sideNames } from '../schema/schemaWording.ts'
import { STATUS_LABEL, type ComparedFile, type FileStatus, type TableDiff } from '../../types.ts'

/**
 * 비교 결과를 사내 공지에 붙일 md 보고서로 만든다.
 *
 * **간단하게 둔다.** 맨 위 표 하나(환경 · 종류 · 변경 건수 · 날짜)로 결론이 보이고,
 * 아래 목록은 무엇이 바뀌었는지만 짚는다. 소스 본문은 넣지 않는다 — 공지로 퍼지는 문서에
 * 코드가 그대로 실려 돌아다니면 안 되고, 몇 파일만 바뀌어도 문서가 수십 쪽이 된다.
 *
 * 숫자는 **화면과 같은 기준**이어야 한다. 제외 목록(팀·내 목록)에 걸린 파일·테이블은
 * 호출하는 쪽에서 이미 빼서 넘긴다 — 화면은 "9건" 인데 보고서는 "12건" 이면 공지가 틀린다.
 */

/** 한쪽이 본 곳 */
export interface ReportSide {
  /** 환경 이름 (`운영`). 환경 설정이 없으면 빈 문자열 */
  env: string
  /** 날짜 폴더 */
  date: string
}

export interface ReportPart<T> {
  left: ReportSide
  right: ReportSide
  items: T[]
}

/**
 * 스키마 쪽. 덤프는 소스와 주기가 달라 날짜가 어긋날 수 있다 —
 * 어긋났으면 보고서에 **어느 날짜 대신 어느 덤프를 썼는지** 적는다. 안 적으면 받는 사람이
 * 소스와 스키마가 같은 시점이라고 읽는다.
 */
export interface SchemaReportPart extends ReportPart<TableDiff> {
  /** 맞춰 달라고 한 날짜 (= 보고서의 소스 날짜) */
  wanted: { left: string; right: string }
  /** 두 날짜가 같은 덤프로 맞춰져 견주지 않았다 — 0건이 아니라 "비교 못 함" 이다 */
  sameDump: boolean
}

export interface ReportInput {
  /** 제외 목록에 걸린 것을 뺀 파일들 (동일 포함) */
  code: ReportPart<ComparedFile> | null
  /** 제외 목록에 걸린 것을 뺀 테이블들 (동일 포함). 스키마를 안 쓰면 null */
  schema: SchemaReportPart | null
}

/** 목록 순서 — 생기고 없어진 것이 바뀐 것보다 눈에 먼저 들어와야 한다 */
const STATUS_ORDER: Record<FileStatus, number> = { added: 0, removed: 1, modified: 2, same: 3 }

const num = (n: number): string => n.toLocaleString('ko-KR')

/** 표 칸 안의 `|` 는 칸을 가른다 — 파일·테이블 이름에 섞여 있어도 표가 깨지지 않게 */
const cell = (text: string): string => text.replace(/\|/g, '\\|')

/** 같으면 한 번만 적는다 (`운영` · `2026-09-01`) */
const pair = (left: string, right: string): string => (left === right ? left : `${left} → ${right}`)

const envText = (part: ReportPart<unknown>): string => pair(part.left.env, part.right.env) || '—'
const dateText = (part: ReportPart<unknown>): string => pair(part.left.date, part.right.date)

const changed = <T extends { status: FileStatus }>(items: readonly T[]): T[] =>
  items.filter((item) => item.status !== 'same')

const byStatusThenName = <T extends { status: FileStatus }>(name: (item: T) => string) =>
  (a: T, b: T): number =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || name(a).localeCompare(name(b))

/**
 * 파일 하나가 얼마나 바뀌었나 — 추가·삭제·변경 줄 중 0 이 아닌 것만 적는다.
 *
 * **화면 파일 목록과 같은 숫자**를 쓴다(비교한 줄 기준 — 무시 옵션으로 뺀 빈 줄·주석은 세지 않는다).
 * 예전에는 통째로 생기거나 없어진 파일만 파일 전체 줄 수를 적어, 화면은 11줄인데 보고서는 14줄이었다.
 */
function fileChange(file: ComparedFile): string {
  const s = file.stats
  const parts = [
    s.added > 0 ? `+${num(s.added)}` : '',
    s.removed > 0 ? `−${num(s.removed)}` : '',
    s.modified > 0 ? `~${num(s.modified)}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? `${parts.join(' ')}줄` : '—'
}

/**
 * 스키마 날짜가 소스 날짜와 어긋났을 때 표 아래에 붙일 설명. 안 어긋났으면 빈 문자열.
 *
 * 같은 덤프로 맞춰졌으면 그것만 말한다 — "가장 가까운 것을 썼다" 보다
 * "그 사이에 덤프가 없어 견주지 못했다" 가 받는 사람이 알아야 할 사실이다.
 */
function schemaDateNote(s: SchemaReportPart): string {
  if (s.sameDump) {
    return `※ 스키마는 두 날짜 사이에 덤프가 없어 비교하지 않았습니다 (가장 가까운 덤프가 둘 다 ${s.left.date}).`
  }
  const swaps = [
    [s.wanted.left, s.left.date],
    [s.wanted.right, s.right.date],
  ]
    .filter(([wanted, used]) => wanted !== used)
    .map(([wanted, used]) => `${wanted} 대신 ${used}`)
  const unique = [...new Set(swaps)]
  if (unique.length === 0) return ''
  return `※ 스키마는 같은 날짜의 덤프가 없어 가장 가까운 덤프로 비교했습니다 (${unique.join(', ')}).`
}

/**
 * 무엇을 담은 보고서인가 — 제목과 파일 이름이 같은 말을 쓴다.
 * 화면의 보고서 메뉴(소스 · 스키마 · 통합)와도 같은 이름이다.
 */
export type ReportKind = 'code' | 'schema' | 'all'

export const reportKindOf = (input: ReportInput): ReportKind =>
  input.code && input.schema ? 'all' : input.schema ? 'schema' : 'code'

const TITLE: Record<ReportKind, string> = {
  code: '소스 비교 보고서',
  schema: '스키마 비교 보고서',
  all: '소스·스키마 비교 보고서',
}

const FILE_KIND: Record<ReportKind, string> = { code: '소스', schema: '스키마', all: '통합' }

function title(input: ReportInput): string {
  const part = input.code ?? input.schema
  const env = part ? pair(part.left.env, part.right.env).replace(' → ', ' ↔ ') : ''
  const name = TITLE[reportKindOf(input)]
  return env ? `# ${name} (${env})` : `# ${name}`
}

export function buildReport(input: ReportInput): string {
  const lines: string[] = [title(input), '']

  lines.push('| 환경 | 종류 | 변경 건수 | 날짜 |', '| ---- | ---- | -------: | ---- |')
  if (input.code) {
    const c = input.code
    lines.push(`| ${envText(c)} | 소스 | ${num(changed(c.items).length)}건 | ${dateText(c)} |`)
  }
  if (input.schema) {
    const s = input.schema
    const count = s.sameDump ? '—' : `${num(changed(s.items).length)}건`
    lines.push(`| ${envText(s)} | 스키마 | ${count} | ${dateText(s)} |`)
    const note = schemaDateNote(s)
    if (note) lines.push('', note)
  }

  // 바뀐 것이 없는 종류는 절을 두지 않는다 — 위 표의 "0건" 이 이미 답이다
  const files = input.code ? changed(input.code.items) : []
  if (files.length > 0) {
    // 상태는 맨 끝 칸 — 파일 이름이 먼저 눈에 들어오고, 스키마 표와 칸 순서가 같다
    lines.push('', '## 소스 변경 내역', '', '| 파일 | 줄 수 | 상태 |', '| ---- | ---- | ---- |')
    for (const file of [...files].sort(byStatusThenName((f: ComparedFile) => f.path))) {
      lines.push(`| ${cell(file.path)} | ${fileChange(file)} | ${STATUS_LABEL[file.status]} |`)
    }
  }

  // 테이블 상태(수정)만 적으면 그 안에서 무엇이 생기고 없어지고 바뀌었는지 알 수 없다 —
  // 바뀐 항목마다 한 줄씩 문장으로 적는다 (`features/schema/schemaWording.ts`)
  const schemaRows = input.schema ? schemaChangeRows(input.schema.items) : []
  if (input.schema && schemaRows.length > 0) {
    // 말의 뜻을 실제 이름으로 못 박는다 — "추가" 가 누구 기준인지 받는 사람이 되묻지 않게
    const legend = changeLegend(sideNames(input.schema.left, input.schema.right))
      .map((l) => `${l.word}: ${l.meaning}`)
      .join(' · ')
    lines.push('', '## 스키마 변경 내역', '', `> ${legend}`, '')
    lines.push('| 테이블 | 구분 | 이름 | 내용 | 상태 |', '| ------ | ---- | ---- | ---- | ---- |')
    for (const row of schemaRows) lines.push(`| ${row.map(cell).join(' | ')} |`)
  }

  return `${lines.join('\n')}\n`
}

/** 파일 이름에 못 쓰는 글자 (윈도우 기준이 가장 엄격하다) */
const unsafe = (text: string): string => text.replace(/[\\/:*?"<>|\s]+/g, '_')

/**
 * 내려받을 파일 이름 — `비교보고서_스키마_운영-2026-09-01_테스트-2026-09-01.md`.
 * 받은 파일이 여러 개 쌓여도 이름만 보고 무엇을(소스·스키마·통합) 어디끼리 견준 것인지 알 수 있게 한다.
 * 종류를 날짜 앞에 둬서 폴더에서 이름순으로 놓으면 종류끼리 모인다.
 */
export function reportFileName(input: ReportInput): string {
  const part = input.code ?? input.schema
  if (!part) return '비교보고서.md'
  const side = (s: ReportSide): string => unsafe([s.env, s.date].filter(Boolean).join('-'))
  return `비교보고서_${FILE_KIND[reportKindOf(input)]}_${side(part.left)}_${side(part.right)}.md`
}
