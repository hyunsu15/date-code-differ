import { num, particle } from '../../lib/format.ts'
import type { SchemaSummary } from './schemaView.ts'
import {
  SCHEMA_KINDS,
  SCHEMA_KIND_LABEL,
  type SchemaKind,
  type SchemaSnapshotRef,
  type Side,
} from '../../types.ts'

/** 한쪽이 보고 있는 스키마 — 고른 날짜와 실제로 읽은 날짜가 다를 수 있다 */
export interface SchemaSide {
  envLabel: string
  /** 환경 색 (`env-prod` 등) — 코드 화면의 좌우 태그와 같은 색을 쓴다 */
  tagClass: string
  /** 화면 위에서 고른 **코드** 날짜 */
  wanted: string
  /** 그에 맞춰 실제로 읽은 **스키마** 날짜 */
  actual: string
  items: SchemaSnapshotRef[]
}

interface SchemaBandProps {
  summary: SchemaSummary
  /** 고른 종류 필터. null 이면 전체 */
  kind: SchemaKind | null
  onSelectKind: (kind: SchemaKind | null) => void
  left: SchemaSide
  right: SchemaSide
  onPickDate: (side: Side, date: string) => void
  loading: boolean
}

/**
 * 스키마 비교 상단 밴드 — 코드 화면의 패키지 밴드와 같은 자리, 같은 모양이다.
 *
 * 두 가지를 한다.
 *
 * 1. **어느 스키마를 보고 있는지 밝힌다.** 스키마 덤프는 소스 배포와 주기가 달라 고른
 *    날짜에 딱 맞는 파일이 없는 것이 보통이고, 그때 이 도구가 "그 시점에 걸려 있던"
 *    스키마를 대신 고른다. 고른 결과를 숨기면 엉뚱한 날짜를 보면서도 모른다 —
 *    다르면 `2026-08-01 → 2026-07-28` 로 화살표를 남기고, 직접 바꿀 수도 있게 둔다.
 *
 * 2. **종류로 목록을 좁힌다.** "이번에 인덱스만 바뀐 테이블" 을 뽑아 보는 일이 잦다.
 */
export default function SchemaBand({
  summary,
  kind,
  onSelectKind,
  left,
  right,
  onPickDate,
  loading,
}: SchemaBandProps) {
  return (
    <div className="package-band schema-band">
      <div className="package-head">
        <span className="label">스키마 변경</span>
        {loading ? (
          <span className="count">읽는 중…</span>
        ) : summary.changed === 0 ? (
          <span className="none">변경된 테이블 없음</span>
        ) : (
          <span className="count">
            {summary.changed}/{summary.tables}개
            {summary.primaryKeyChanged > 0 && (
              <b className="pk-warn" title="기본키가 바뀐 테이블입니다. 데이터 이관·중복을 함께 확인하세요.">
                {' '}
                · ⚠ 기본키 {summary.primaryKeyChanged}
              </b>
            )}
          </span>
        )}

        {/* 접은 것을 조용히 지우지 않는다 — 그 자리에 진짜 변경이 섞여도 알 수 있어야 한다 */}
        {summary.systemHidden > 0 && (
          <span
            className="sys-hidden"
            title={
              'DB 가 자동으로 붙인 이름(SYS_C…)이라 접었습니다.\n' +
              '번호가 데이터베이스마다 달라, 접지 않으면 내용이 같아도 전부 변경으로 뜹니다.\n' +
              'change/config.ts 의 SCHEMA.systemNamePattern 에서 규칙을 바꿀 수 있습니다.'
            }
          >
            · 시스템 {num(summary.systemHidden)} 접음
          </span>
        )}

        <div className="schema-dates">
          <SidePicker side="left" info={left} onPick={onPickDate} />
          <span className="arrow">⇄</span>
          <SidePicker side="right" info={right} onPick={onPickDate} />
        </div>
      </div>

      <div className="package-chips">
        <button
          type="button"
          className={`pkg-chip all ${kind === null ? 'active' : ''}`}
          onClick={() => onSelectKind(null)}
        >
          전체 <span className="pkg-counts">{num(summary.tables)}</span>
        </button>

        {SCHEMA_KINDS.map((k) => {
          const count = summary.changedByKind[k]
          return (
            <button
              key={k}
              type="button"
              className={`pkg-chip s-${count > 0 ? 'modified' : 'same'} ${kind === k ? 'active' : ''}`}
              onClick={() => onSelectKind(kind === k ? null : k)}
              disabled={count === 0}
              title={
                count > 0
                  ? `${SCHEMA_KIND_LABEL[k]}${particle(SCHEMA_KIND_LABEL[k], '이', '가')} 바뀐 테이블 ${count}개만 봅니다`
                  : `${SCHEMA_KIND_LABEL[k]}에는 변경이 없습니다`
              }
            >
              <span className="pkg-name">{SCHEMA_KIND_LABEL[k]}</span>
              <span className="pkg-counts">{count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 한쪽의 스키마 날짜.
 *
 * 자동으로 고른 것이 맞지 않을 때를 위해 직접 고를 수 있게 둔다 — 기본은 자동,
 * 손대면 그 값이 그대로 간다.
 */
function SidePicker({
  side,
  info,
  onPick,
}: {
  side: Side
  info: SchemaSide
  onPick: (side: Side, date: string) => void
}) {
  const auto = info.actual !== '' && info.actual !== info.wanted

  if (info.items.length === 0) {
    return (
      <span className="schema-date empty" title="이 환경에는 스키마 파일이 없습니다">
        <span className={`side-tag ${info.tagClass}`}>{info.envLabel}</span>
        <span className="none">없음</span>
      </span>
    )
  }

  return (
    <span className="schema-date">
      <span className={`side-tag ${info.tagClass}`}>{info.envLabel}</span>

      {/* 고른 코드 날짜와 다르면 무엇으로 대신했는지 남긴다 */}
      {auto && (
        <span className="wanted" title={`고른 날짜 ${info.wanted} 에 맞는 스키마가 없어 그 이전 것으로 맞췄습니다`}>
          {info.wanted} →
        </span>
      )}

      <select
        className="select sm"
        value={info.actual}
        onChange={(e) => onPick(side, e.target.value)}
        title="스키마 날짜를 직접 고릅니다"
      >
        {info.items.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id}
          </option>
        ))}
      </select>
    </span>
  )
}
