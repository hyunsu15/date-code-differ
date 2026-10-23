import { excludedRows } from './schemaView.ts'
import { kindSummary, tableLabel } from './schemaWording.ts'
import { SCHEMA_KINDS, type TableDiff } from '../../types.ts'
import SameFold from '../files/SameFold.tsx'

interface TableListProps {
  /** 바뀐 테이블 — 늘 보인다 */
  tables: TableDiff[]
  /** 동일한 테이블 — 맨 아래 접힘 줄 밑. 펼쳤거나 검색 중일 때만 보인다 */
  same: TableDiff[]
  sameOpen: boolean
  /** 검색 중 — 동일한 것도 접기와 상관없이 맞는 것을 보여준다 */
  searching: boolean
  onToggleSame: () => void
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
 * 종류는 뷰어 안에서 섹션으로 나누고, 여기서는 종류별로 몇 줄이 바뀌었는지만 글자로 적는다
 * (`컬럼 4 · 제약 1 · 인덱스 2`). 예전의 점과 `+2 −1 ~1` 은 어느 종류의 숫자인지 읽히지 않았다.
 *
 * 배지는 **테이블이 통째로 생기거나 없어졌을 때만** 단다. 안의 무엇이 바뀐 테이블에
 * "변경" 배지를 달면, 그게 테이블의 상태인지 안의 항목인지 헷갈린다 — 둘째 줄이 그 몫을 한다.
 *
 * 항목마다 **접기 버튼**이 있다. 지금 보고 있는 변경과 상관없는 테이블을 치우는 데
 * 팀 규칙 파일을 고칠 수는 없어서, 그 자리에서 바로 접을 수 있어야 한다.
 */
export default function TableList({
  tables,
  same,
  sameOpen,
  searching,
  onToggleSame,
  selectedName,
  onSelect,
  onToggleExclude,
  emptyMessage,
}: TableListProps) {
  if (tables.length === 0 && same.length === 0) {
    return (
      <div className="filelist">
        <div className="filelist-empty">{emptyMessage}</div>
      </div>
    )
  }

  const item = (table: TableDiff) => {
        const whole = tableLabel(table)
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
                {whole && <span className={`badge s-${table.status}`}>{whole}</span>}
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
                  <span className="kind-summary">{kindSummary(table)}</span>
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
                    '펼치려면 ⚙ 설정 → 제외 규칙 의 팀 스키마 제외 목록 파일을 고치세요.'
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
  }

  return (
    <div className="filelist">
      {/* 바뀐 것이 없어도 동일한 것을 펼쳐 볼 수 있게, 접힘 줄은 그대로 둔다 */}
      {tables.length === 0 && (
        <div className="filelist-empty slim">
          {searching ? '바뀐 테이블 중에는 맞는 것이 없습니다' : '바뀐 테이블이 없습니다'}
        </div>
      )}
      {tables.map(item)}
      <SameFold count={same.length} open={sameOpen} searching={searching} noun="테이블" onToggle={onToggleSame} />
      {(sameOpen || searching) && same.map(item)}
    </div>
  )
}
