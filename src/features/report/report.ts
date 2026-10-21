import { SCHEMA_KINDS, SCHEMA_KIND_LABEL, type ComparedFile, type FileStatus, type TableDiff } from '../../types.ts'

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

export interface ReportInput {
  /** 제외 목록에 걸린 것을 뺀 파일들 (동일 포함) */
  code: ReportPart<ComparedFile> | null
  /** 제외 목록에 걸린 것을 뺀 테이블들 (동일 포함). 스키마를 안 쓰면 null */
  schema: ReportPart<TableDiff> | null
}

const STATUS_LABEL: Record<FileStatus, string> = {
  added: '신규',
  removed: '삭제',
  modified: '수정',
  same: '동일',
}

/** 목록 순서 — 생기고 없어진 것이 수정보다 눈에 먼저 들어와야 한다 */
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
 * 파일 하나가 얼마나 바뀌었나.
 * 생기거나 없어진 파일은 줄 수 전체, 수정은 추가·삭제·수정 줄 중 0 이 아닌 것만 적는다.
 */
function fileChange(file: ComparedFile): string {
  const s = file.stats
  if (file.status === 'added') return `+${num(s.bLines)}줄`
  if (file.status === 'removed') return `−${num(s.aLines)}줄`
  const parts = [
    s.added > 0 ? `+${num(s.added)}` : '',
    s.removed > 0 ? `−${num(s.removed)}` : '',
    s.modified > 0 ? `~${num(s.modified)}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? `${parts.join(' ')}줄` : '—'
}

/** 테이블 하나가 얼마나 바뀌었나 — 종류별 바뀐 줄 수, 기본키가 움직였으면 따로 적는다 */
function tableChange(table: TableDiff): string {
  const parts = SCHEMA_KINDS.map((kind) => {
    const s = table.sections[kind]
    const count = s.added + s.removed + s.modified
    return count > 0 ? `${SCHEMA_KIND_LABEL[kind]} ${num(count)}` : ''
  }).filter(Boolean)
  if (table.primaryKeyChanged) parts.push('⚠ 기본키 변경')
  return parts.length > 0 ? parts.join(' · ') : '—'
}

function title(input: ReportInput): string {
  const part = input.code ?? input.schema
  const env = part ? pair(part.left.env, part.right.env).replace(' → ', ' ↔ ') : ''
  return env ? `# 소스 비교 보고서 (${env})` : '# 소스 비교 보고서'
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
    lines.push(`| ${envText(s)} | 스키마 | ${num(changed(s.items).length)}건 | ${dateText(s)} |`)
  }

  // 바뀐 것이 없는 종류는 절을 두지 않는다 — 위 표의 "0건" 이 이미 답이다
  const files = input.code ? changed(input.code.items) : []
  if (files.length > 0) {
    lines.push('', '## 소스 변경 내역', '', '| 상태 | 파일 | 변경 |', '| ---- | ---- | ---- |')
    for (const file of [...files].sort(byStatusThenName((f: ComparedFile) => f.path))) {
      lines.push(`| ${STATUS_LABEL[file.status]} | ${cell(file.path)} | ${fileChange(file)} |`)
    }
  }

  const tables = input.schema ? changed(input.schema.items) : []
  if (tables.length > 0) {
    lines.push('', '## 스키마 변경 내역', '', '| 상태 | 테이블 | 변경 |', '| ---- | ------ | ---- |')
    for (const table of [...tables].sort(byStatusThenName((t: TableDiff) => t.name))) {
      lines.push(`| ${STATUS_LABEL[table.status]} | ${cell(table.name)} | ${tableChange(table)} |`)
    }
  }

  return `${lines.join('\n')}\n`
}

/** 파일 이름에 못 쓰는 글자 (윈도우 기준이 가장 엄격하다) */
const unsafe = (text: string): string => text.replace(/[\\/:*?"<>|\s]+/g, '_')

/**
 * 내려받을 파일 이름 — `비교보고서_운영-2026-09-01_테스트-2026-09-01.md`.
 * 받은 파일이 여러 개 쌓여도 이름만 보고 무엇을 견준 것인지 알 수 있게 한다.
 */
export function reportFileName(input: ReportInput): string {
  const part = input.code ?? input.schema
  if (!part) return '비교보고서.md'
  const side = (s: ReportSide): string => unsafe([s.env, s.date].filter(Boolean).join('-'))
  return `비교보고서_${side(part.left)}_${side(part.right)}.md`
}
