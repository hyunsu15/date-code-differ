import { num } from '../../lib/format.ts'
import type { PackageChange, PackageStatus } from '../../types.ts'

const STATUS_LABEL: Record<PackageStatus, string> = {
  added: '신규',
  removed: '삭제',
  modified: '변경',
  same: '동일',
}

interface PackageSummaryProps {
  packages: PackageChange[]
  /** 선택된 패키지명. null 이면 전체 */
  selected: string | null
  onSelect: (name: string | null) => void
}

/**
 * 파일을 고르기 전에 "어느 패키지가 움직였는지" 부터 보여주는 상단 밴드.
 * 칩을 누르면 아래 파일 목록이 그 패키지로 좁혀진다.
 */
export default function PackageSummary({ packages, selected, onSelect }: PackageSummaryProps) {
  if (packages.length === 0) return null

  const changed = packages.filter((p) => p.status !== 'same')
  const totalChangedLines = changed.reduce((sum, p) => sum + p.changedLines, 0)

  return (
    <div className="package-band">
      <div className="package-head">
        <span className="label">패키지 변경</span>
        {changed.length === 0 ? (
          <span className="none">변경된 패키지 없음</span>
        ) : (
          <span className="count">
            {changed.length}/{packages.length}개 · {num(totalChangedLines)}줄
          </span>
        )}
      </div>

      <div className="package-chips">
        <button
          type="button"
          className={`pkg-chip all ${selected === null ? 'active' : ''}`}
          onClick={() => onSelect(null)}
        >
          전체
        </button>

        {packages.map((p) => (
          <button
            key={p.name}
            type="button"
            className={`pkg-chip s-${p.status} ${selected === p.name ? 'active' : ''}`}
            onClick={() => onSelect(selected === p.name ? null : p.name)}
            title={`${p.name} — 신규 ${p.added} · 삭제 ${p.removed} · 수정 ${p.modified} · 동일 ${p.same}`}
          >
            <span className="pkg-name">{p.name}</span>
            <span className="pkg-status">{STATUS_LABEL[p.status]}</span>
            {p.status !== 'same' && (
              <span className="pkg-counts">
                {p.added > 0 && <i className="add">+{p.added}</i>}
                {p.removed > 0 && <i className="del">−{p.removed}</i>}
                {p.modified > 0 && <i className="mod">~{p.modified}</i>}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
