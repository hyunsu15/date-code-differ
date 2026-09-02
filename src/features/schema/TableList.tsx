import { changedRows, excludedRows } from './schemaView.ts'
import { SCHEMA_KINDS, type SchemaItemStatus, type TableDiff } from '../../types.ts'

const STATUS_LABEL: Record<SchemaItemStatus, string> = {
  added: '신규',
  removed: '삭제',
  modified: '변경',
  same: '동일',
}

interface TableListProps {
  tables: TableDiff[]
  selectedName: string | null
  onSelect: (name: string) => void
  /** 내 제외 목록에 넣거나 뺀다 (`features/schema/schemaExclude.ts`) */
  onToggleExclude: (table: string) => void
  emptyMessage: string
}

/**
 * 좌우 대조 결과 테이블 목록 — 코드 화면의 파일 목록과 같은 자리, 같은 모양이다.
 *
 * **종류(컬럼·제약·인덱스)로 나누지 않는다.** 셋은 서로 나란한 객체가 아니라 한
 * 테이블의 속성이라, 목록에서 갈라 두면 같은 테이블을 세 번 눌러야 한다.
 * 종류는 뷰어 안에서 섹션으로 나누고, 여기서는 어떤 종류가 움직였는지만 점으로 알린다.
 *
 * 항목마다 **접기 버튼**이 있다. 지금 보고 있는 변경과 상관없는 테이블을 치우는 데
 * 팀 규칙 파일을 고칠 수는 없어서, 그 자리에서 바로 접을 수 있어야 한다.
 */
export default function TableList({
  tables,
  selectedName,
  onSelect,
  onToggleExclude,
  emptyMessage,
}: TableListProps) {
  if (tables.length === 0) {
    return (
      <div className="filelist">
        <div className="filelist-empty">{emptyMessage}</div>
      </div>
    )
  }

  return (
    <div className="filelist">
      {tables.map((table) => {
        const changed = changedRows(table)
        const systemHidden = SCHEMA_KINDS.reduce((s, k) => s + table.sections[k].systemHidden, 0)
        const hidden = excludedRows(table)
        // 팀 규칙 파일 때문에 접힌 것은 여기서 펼 수 없다 — 고칠 자리가 다르다
        const byFile = table.excluded && !table.excludedLocal

        return (
          <div
            key={table.name}
            className={[
              'file-item',
              table.name === selectedName ? 'active' : '',
              table.excluded ? 'excluded' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className="file-open"
              onClick={() => onSelect(table.name)}
              title={
                table.excluded ? `${table.name}\n제외 규칙: ${table.excludedBy}` : table.name
              }
            >
              <div className="row1">
                <span className="fname">{table.name}</span>
                <span className={`badge s-${table.status}`}>{STATUS_LABEL[table.status]}</span>
                {table.excluded && (
                  <span className="badge s-excluded">
                    {table.excludedLocal ? '내 제외' : '제외'}
                  </span>
                )}
                {/* 기본키 변경은 빈도가 낮고 위험이 커서 목록에서 바로 보여야 한다 */}
                {table.primaryKeyChanged && (
                  <span className="badge s-pk" title="기본키가 바뀐 테이블입니다">
                    ⚠ 기본키
                  </span>
                )}
              </div>

              {table.excluded && (
                <div className="excl-why">
                  {table.excludedLocal ? '내 목록' : '규칙'} · {table.excludedBy}
                </div>
              )}

              <div className="row2 schema-row2">
                {table.status === 'same' ? (
                  <span className="no-sim">
                    동일
                    {hidden > 0 && ` · 제외 ${hidden}`}
                    {systemHidden > 0 && ` · 시스템 ${systemHidden}`}
                  </span>
                ) : (
                  <>
                    <span className="kinds">
                      {SCHEMA_KINDS.filter((k) => table.changedKinds.includes(k)).map((k) => (
                        <i key={k} className={`kind-dot k-${k}`} />
                      ))}
                    </span>
                    <span className="changed-lines">{changed}줄</span>
                    {SCHEMA_KINDS.map((k) => {
                      const s = table.sections[k]
                      return (
                        <span key={k} className="kind-counts">
                          {s.added > 0 && <i className="add">+{s.added}</i>}
                          {s.removed > 0 && <i className="del">−{s.removed}</i>}
                          {s.modified > 0 && <i className="mod">~{s.modified}</i>}
                        </span>
                      )
                    })}
                  </>
                )}
              </div>
            </button>

            <button
              type="button"
              className="file-excl"
              onClick={() => onToggleExclude(table.name)}
              disabled={byFile}
              title={
                byFile
                  ? `팀 규칙 파일에 적혀 접힌 테이블입니다 (${table.excludedBy}).\n` +
                    '펼치려면 ⚙ 위치 의 스키마 제외 목록 파일을 고치세요.'
                  : table.excludedLocal
                    ? `내 제외 목록에서 뺍니다 (규칙: ${table.excludedBy})`
                    : '내 제외 목록에 넣어 접습니다 (이 브라우저에만 남습니다)'
              }
              aria-label={table.excludedLocal ? '내 제외 목록에서 빼기' : '내 제외 목록에 넣기'}
            >
              {table.excludedLocal ? '↩' : '⊘'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
