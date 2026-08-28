import { pct, simColor, splitPath } from '../../lib/format.ts'
import type { ComparedFile, FileStatus } from '../../types.ts'

const STATUS_LABEL: Record<FileStatus, string> = {
  added: '신규',
  removed: '삭제',
  modified: '변경',
  same: '동일',
}

interface FileListProps {
  files: ComparedFile[]
  selectedPath: string | null
  onSelect: (path: string) => void
  /** 목록이 비었을 때 보여줄 안내 */
  emptyMessage: string
}

/**
 * 좌우 비교 결과 파일 목록.
 * 유사도 막대는 양쪽에 모두 있는 파일에만 뜬다 (신규/삭제는 비교 대상이 없다).
 */
export default function FileList({ files, selectedPath, onSelect, emptyMessage }: FileListProps) {
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

        return (
          <button
            key={f.path}
            type="button"
            className={`file-item ${f.path === selectedPath ? 'active' : ''}`}
            onClick={() => onSelect(f.path)}
            title={f.path}
          >
            <div className="row1">
              <span className="fname">{name}</span>
              <span className={`badge s-${f.status}`}>{STATUS_LABEL[f.status]}</span>
            </div>

            {dir && <div className="fdir">{dir}</div>}

            <div className="row2">
              {oneSided ? (
                <span className="no-sim">
                  {f.status === 'added'
                    ? `이후 스냅샷에만 있음 · ${f.stats.added}줄`
                    : `이전 스냅샷에만 있음 · ${f.stats.removed}줄`}
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
        )
      })}
    </div>
  )
}
