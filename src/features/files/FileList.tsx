import { pct, simColor, splitPath } from '../../lib/format.ts'
import { STATUS_LABEL, type ComparedFile } from '../../types.ts'

interface FileListProps {
  files: ComparedFile[]
  selectedPath: string | null
  onSelect: (path: string) => void
  /**
   * **내 제외 목록**에 넣거나 뺀다 (`features/settings/localExclude.ts`).
   * 팀이 함께 쓰는 규칙 파일은 여기서 건드리지 않는다.
   */
  onToggleExclude: (path: string) => void
  /** 목록이 비었을 때 보여줄 안내 */
  emptyMessage: string
}

/**
 * 좌우 비교 결과 파일 목록.
 * 유사도 막대는 양쪽에 모두 있는 파일에만 뜬다 (신규/삭제는 비교 대상이 없다).
 *
 * 제외 목록에 걸린 파일은 **지우지 않고 흐리게** 둔다 (펼쳤을 때). 같은 자리에 그대로
 * 있어야 "왜 이게 안 보이지" 가 풀리고, 어떤 규칙에 걸렸는지도 함께 보여 준다 —
 * 규칙을 고칠 곳을 바로 알 수 있어야 접기가 무섭지 않다.
 *
 * 항목마다 **접기 버튼**이 있다. 지금 보고 있는 변경과 상관없는 파일 두어 개를 치우는
 * 데 팀 규칙 파일을 고칠 수는 없어서, 그 자리에서 바로 접을 수 있어야 한다.
 */
export default function FileList({
  files,
  selectedPath,
  onSelect,
  onToggleExclude,
  emptyMessage,
}: FileListProps) {
  if (files.length === 0) {
    return (
      <div className="filelist">
        <div className="filelist-empty">{emptyMessage}</div>
      </div>
    )
  }

  return (
    <div className="filelist">
      {files.map((f) => {
        const { dir, name } = splitPath(f.path)
        // 한쪽에만 있는 파일은 비교 대상이 없으므로 유사도 막대 대신 안내를 보여준다
        const oneSided = f.status === 'added' || f.status === 'removed'
        // 규칙 파일 때문에 접힌 것은 여기서 펼 수 없다 — 고칠 자리가 다르다
        const byFile = f.excluded && !f.excludedLocal

        return (
          <div
            key={f.path}
            className={[
              'file-item',
              f.path === selectedPath ? 'active' : '',
              f.excluded ? 'excluded' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className="file-open"
              onClick={() => onSelect(f.path)}
              title={f.excluded ? `${f.path}\n제외 규칙: ${f.excludedBy}` : f.path}
            >
              <div className="row1">
                <span className="fname">{name}</span>
                <span className={`badge s-${f.status}`}>{STATUS_LABEL[f.status]}</span>
                {f.excluded && (
                  <span className="badge s-excluded">{f.excludedLocal ? '내 제외' : '제외'}</span>
                )}
              </div>

              {dir && <div className="fdir">{dir}</div>}

              {f.excluded && (
                <div className="excl-why">
                  {f.excludedLocal ? '내 목록' : '규칙'} · {f.excludedBy}
                </div>
              )}

              <div className="row2">
                {oneSided ? (
                  <span className="no-sim">
                    {/* 추가·삭제는 배지가 이미 말한다 — 여기는 크기만. "이후 스냅샷에만" 은
                        환경 간 비교(운영 → 테스트)에서는 이전·이후가 아니라 틀린 말이었다 */}
                    파일 전체 · {f.status === 'added' ? f.stats.added : f.stats.removed}줄
                  </span>
                ) : (
                  <>
                    <span className="simbar">
                      <i
                        style={{
                          width: `${f.stats.lineSimilarity * 100}%`,
                          background: simColor(f.stats.lineSimilarity),
                        }}
                      />
                    </span>
                    <span className="simpct" style={{ color: simColor(f.stats.lineSimilarity) }}>
                      {pct(f.stats.lineSimilarity, 0)}
                    </span>
                    {f.stats.added > 0 && <span className="add">+{f.stats.added}</span>}
                    {f.stats.removed > 0 && <span className="del">−{f.stats.removed}</span>}
                    {f.stats.modified > 0 && <span className="mod">~{f.stats.modified}</span>}
                  </>
                )}
              </div>
            </button>

            <button
              type="button"
              className="file-excl"
              onClick={() => onToggleExclude(f.path)}
              disabled={byFile}
              title={
                byFile
                  ? `규칙 파일에 적혀 접힌 파일입니다 (${f.excludedBy}).\n` +
                    '펼치려면 ⚙ 위치 의 제외 목록 파일을 고치세요.'
                  : f.excludedLocal
                    ? `내 제외 목록에서 뺍니다 (규칙: ${f.excludedBy})`
                    : '내 제외 목록에 넣어 접습니다 (이 브라우저에만 남습니다)'
              }
              aria-label={f.excludedLocal ? '내 제외 목록에서 빼기' : '내 제외 목록에 넣기'}
            >
              {f.excludedLocal ? '↩' : '⊘'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
