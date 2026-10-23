import { useState } from 'react'
import { num, particle } from '../../lib/format.ts'
import { rowLabel, sectionSummary } from './schemaWording.ts'
import {
  SCHEMA_KINDS,
  type FileStatus,
  SCHEMA_KIND_LABEL,
  type SchemaCell,
  type SchemaKind,
  type SchemaRow,
  type SchemaSection,
  type TableDiff,
} from '../../types.ts'

interface SchemaTableProps {
  table: TableDiff
  /** 좌우 칸 머리에 적을 이름 (`운영 2026-08-01`) */
  leftLabel: string
  rightLabel: string
  leftTagClass: string
  rightTagClass: string
  /** 바뀌지 않은 줄도 보여줄지 */
  showSame: boolean
  /** 접어 둔 줄도 보여줄지 */
  showExcluded: boolean
  /** 줄 하나를 내 제외 목록에 넣거나 뺀다 */
  onToggleExclude: (member: string) => void
}

/**
 * 테이블 하나의 좌우 대조 — 컬럼 · 제약 · 인덱스 세 섹션.
 *
 * **나란한 두 판이 아니라 한 표에 좌우를 합친다.** 이름으로 짝지어진 줄이므로
 * 한 줄 안에 `왼쪽 → 오른쪽` 을 두면 바뀐 곳이 눈에 바로 든다. 판을 갈라 두면
 * 순서가 어긋난 순간 눈이 계속 왔다 갔다 한다.
 *
 * 줄 앞에는 **무엇이 어떻게 됐는지 말로** 적는다(`추가` · `삭제` · `타입 변경`).
 * 예전의 `+ ~ −` 는 뜻을 알아야 읽혔고, `~` 가 타입인지 NOT NULL 인지 알 수 없었다.
 * 말은 보고서와 같은 곳(`schemaWording.ts`)에서 온다.
 *
 * 바뀌지 않은 줄은 값을 **한 번만** 적는다. 같은 값을 두 번 적으면 그게 화면의
 * 대부분을 차지해, 정작 바뀐 한 줄이 묻힌다.
 *
 * 줄마다 **접기 버튼**이 있다 — `REG_DTM` 처럼 늘 시끄러운 컬럼을 그 자리에서 치운다.
 */
/** 섹션 머리 집계의 색 — 기존 `.add` · `.del` · `.mod` 를 그대로 쓴다 */
const STATUS_CLASS: Record<FileStatus, string> = { added: 'add', removed: 'del', modified: 'mod', same: '' }

export default function SchemaTable({
  table,
  leftLabel,
  rightLabel,
  leftTagClass,
  rightTagClass,
  showSame,
  showExcluded,
  onToggleExclude,
}: SchemaTableProps) {
  return (
    <div className="schema-view">
      {SCHEMA_KINDS.map((kind) => (
        <Section
          key={kind}
          kind={kind}
          section={table.sections[kind]}
          leftLabel={leftLabel}
          rightLabel={rightLabel}
          leftTagClass={leftTagClass}
          rightTagClass={rightTagClass}
          showSame={showSame}
          showExcluded={showExcluded}
          onToggleExclude={onToggleExclude}
        />
      ))}
    </div>
  )
}

function Section({
  kind,
  section,
  leftLabel,
  rightLabel,
  leftTagClass,
  rightTagClass,
  showSame,
  showExcluded,
  onToggleExclude,
}: {
  kind: SchemaKind
  section: SchemaSection
  leftLabel: string
  rightLabel: string
  leftTagClass: string
  rightTagClass: string
  showSame: boolean
  showExcluded: boolean
  onToggleExclude: (member: string) => void
}) {
  const [open, setOpen] = useState(true)

  const rows = section.rows.filter((row) => {
    if (row.excluded) return showExcluded
    return showSame || row.status !== 'same'
  })
  const changed = section.added + section.removed + section.modified
  const label = SCHEMA_KIND_LABEL[kind]

  return (
    <section className={`schema-section ${open ? '' : 'closed'}`}>
      <button type="button" className="schema-head" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="label">{label}</span>
        <span className="total">{num(section.total)}개</span>

        {changed > 0 && (
          <span className="counts">
            {sectionSummary(section).map((c) => (
              <i key={c.status} className={STATUS_CLASS[c.status]}>
                {c.text}
              </i>
            ))}
          </span>
        )}

        {/* 접은 것을 조용히 지우지 않는다 (`schemaDiff.recountSection` 주석 참고) */}
        {section.excludedHidden > 0 && (
          <span
            className="excl-hidden"
            title={
              '제외 목록이나 종류 토글로 접어 둔 줄입니다.\n' +
              (section.excludedChanged > 0
                ? `그중 ${section.excludedChanged}개는 실제로 바뀌었습니다.\n`
                : '') +
              '목록 위의 "제외" 를 눌러 펼쳐 볼 수 있습니다.'
            }
          >
            제외 {num(section.excludedHidden)}
            {section.excludedChanged > 0 && <b> · 변경 {section.excludedChanged}</b>}
          </span>
        )}

        {section.systemHidden > 0 && (
          <span
            className="sys-hidden"
            title={
              'DB 가 자동으로 붙인 이름(SYS_C…)이라 접었습니다.\n' +
              '번호가 데이터베이스마다 달라 내용이 같아도 전부 변경으로 보이기 때문입니다.\n' +
              'NOT NULL 여부는 컬럼 섹션에 그대로 있습니다.'
            }
          >
            시스템 {num(section.systemHidden)} 접음
          </span>
        )}
      </button>

      {open &&
        (rows.length === 0 ? (
          <div className="schema-empty">
            {section.total === 0 && section.excludedHidden > 0
              ? `${label}${particle(label, '을', '를')} 통째로 접어 뒀습니다.`
              : section.total === 0
                ? `${label}${particle(label, '이', '가')} 없습니다.`
                : `바뀐 ${label}${particle(label, '이', '가')} 없습니다.`}
          </div>
        ) : (
          <div className="schema-rows">
            <div className="srow head">
              <span className="mark">상태</span>
              <span className="sname">이름</span>
              <span className="sval">
                <span className={`side-tag ${leftTagClass}`}>{leftLabel}</span>
              </span>
              <span className="sarrow" />
              <span className="sval">
                <span className={`side-tag ${rightTagClass}`}>{rightLabel}</span>
              </span>
              <span className="sexcl" />
            </div>

            {rows.map((row) => (
              <Row
                key={row.name}
                row={row}
                label={rowLabel(kind, row)}
                leftLabel={leftLabel}
                rightLabel={rightLabel}
                onToggleExclude={onToggleExclude}
              />
            ))}
          </div>
        ))}
    </section>
  )
}

function Row({
  row,
  label,
  leftLabel,
  rightLabel,
  onToggleExclude,
}: {
  row: SchemaRow
  /** 줄 앞 칩에 적을 말. 바뀌지 않은 줄은 빈 문자열 */
  label: string
  leftLabel: string
  rightLabel: string
  onToggleExclude: (member: string) => void
}) {
  // 팀 규칙 파일이나 종류 토글로 접힌 줄은 여기서 펼 수 없다 — 고칠 자리가 다르다
  const byFile = row.excluded && !row.excludedLocal

  const excl = (
    <button
      type="button"
      className="sexcl"
      onClick={() => onToggleExclude(row.name)}
      disabled={byFile}
      title={
        byFile
          ? row.excludedBy
            ? `팀 규칙 파일에 적혀 접힌 줄입니다 (${row.excludedBy}).`
            : '종류 토글로 접힌 줄입니다 — 위 옵션바에서 켜세요.'
          : row.excludedLocal
            ? `내 제외 목록에서 뺍니다 (규칙: ${row.excludedBy})`
            : '내 제외 목록에 넣어 접습니다 (이 브라우저에만 남습니다)'
      }
      aria-label={row.excludedLocal ? '내 제외 목록에서 빼기' : '내 제외 목록에 넣기'}
    >
      {row.excludedLocal ? '↩' : '⊘'}
    </button>
  )

  const classes = ['srow', `s-${row.status}`, row.excluded ? 'excluded' : ''].filter(Boolean)

  // 양쪽이 같으면 값을 한 번만 적는다 — 같은 글자를 두 번 두면 바뀐 줄이 묻힌다
  if (row.status === 'same') {
    return (
      <div className={classes.join(' ')}>
        <span className="mark" />
        <span className="sname">{row.name}</span>
        <span className="sval both">
          <Value cell={row.right ?? row.left} side="" />
        </span>
        {excl}
      </div>
    )
  }

  return (
    <div className={classes.join(' ')}>
      <span className="mark">
        <span className="schg">{label}</span>
      </span>
      <span className="sname">{row.name}</span>
      <span className="sval left">
        <Value cell={row.left} side={leftLabel} />
      </span>
      <span className="sarrow">→</span>
      <span className="sval right">
        <Value cell={row.right} side={rightLabel} />
      </span>
      {excl}
    </div>
  )
}

/**
 * 한쪽 값. 없으면 **"없음" 이라고 적는다** — 줄표(`—`) 한 글자로는 "없다" 로 읽히지 않았다.
 * 어느 쪽에 없는지는 툴팁으로 (`운영 2026-08-01에 없음`).
 */
function Value({ cell, side }: { cell: SchemaCell | null; side: string }) {
  if (cell === null) {
    return (
      <span className="none" title={side ? `${side}에 없음` : undefined}>
        없음
      </span>
    )
  }
  return (
    <>
      {cell.badge && <span className="kbadge">{cell.badge}</span>}
      <span className="text">{cell.value || '—'}</span>
      {/*
        타입과 붙여 쓰지 않고 칩으로 뗀다 — 한 덩어리로 읽히면 타입이 바뀐 것인지
        널 여부가 바뀐 것인지 눈으로 가르기 어렵다.
      */}
      {cell.note && (
        <span
          className="nn"
          title={'널(빈 값)을 넣을 수 없는 컬럼입니다.\n이 표시가 붙거나 풀린 것도 변경으로 잡습니다.'}
        >
          {cell.note}
        </span>
      )}
    </>
  )
}
