import { num, particle } from '../../lib/format.ts'
import type { SchemaSummary } from './schemaView.ts'
import { SCHEMA_KINDS, SCHEMA_KIND_LABEL, type SchemaKind } from '../../types.ts'

interface SchemaBandProps {
  summary: SchemaSummary
  /** 고른 종류 필터. null 이면 전체 */
  kind: SchemaKind | null
  onSelectKind: (kind: SchemaKind | null) => void
  loading: boolean
}

/**
 * 스키마 비교 상단 밴드 — 코드 화면의 패키지 밴드와 같은 자리, 같은 모양이다.
 *
 * **날짜를 고르는 자리는 여기 없다.** 좌우 선택은 코드 화면과 같은 헤더 컨트롤이
 * 다룬다 — 같은 일을 하는 컨트롤이 두 벌이면 탭을 옮길 때마다 다시 골라야 하고,
 * 생김새가 살짝 달라 어색해진다.
 *
 * 여기서 하는 일은 **요약**과 **종류로 목록 좁히기** 둘이다.
 * "이번에 인덱스만 바뀐 테이블" 을 뽑아 보는 일이 잦다.
 */
export default function SchemaBand({ summary, kind, onSelectKind, loading }: SchemaBandProps) {
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
              <b
                className="pk-warn"
                title="기본키가 바뀐 테이블입니다. 데이터 이관·중복을 함께 확인하세요."
              >
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
