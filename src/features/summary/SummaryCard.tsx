import { num, pct, simColor } from '../../lib/format.ts'
import type { DiffStats } from '../../types.ts'

interface RingProps {
  value: number
  size?: number
  stroke?: number
}

function Ring({ value, size = 62, stroke = 6 }: RingProps) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value || 0))
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={simColor(v)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset 0.35s ease' }}
        />
      </svg>
      <div className="val" style={{ color: simColor(v) }}>
        {(v * 100).toFixed(0)}%
      </div>
    </div>
  )
}

interface SummaryCardProps {
  stats: DiffStats
  fileCount: number
  /** 변경(수정·신규·삭제)된 파일 수 */
  changedCount: number
  leftLabel: string
  rightLabel: string
  loading: boolean
}

/**
 * 두 스냅샷 전체의 유사도 요약.
 * 유사도 = 완전히 일치한 줄 수 / 더 긴 쪽의 줄 수  ← "줄 갯수 대비 diff"
 */
export default function SummaryCard({
  stats,
  fileCount,
  changedCount,
  leftLabel,
  rightLabel,
  loading,
}: SummaryCardProps) {
  return (
    <div className="summary">
      <h3>
        전체 유사도
        {loading && <span style={{ color: 'var(--accent)' }}> · 계산 중…</span>}
      </h3>

      <div className="gauge">
        <Ring value={stats.lineSimilarity} />
        <div className="meta">
          <div>
            일치 <b>{num(stats.same)}</b>줄 / 비교{' '}
            <b>{num(Math.max(stats.comparedA, stats.comparedB))}</b>줄
          </div>
          <div>
            <span style={{ color: 'var(--del-fg)' }}>−{num(stats.removed)}</span>{' '}
            <span style={{ color: 'var(--add-fg)' }}>+{num(stats.added)}</span>{' '}
            <span style={{ color: '#d29922' }}>~{num(stats.modified)}</span>
          </div>
          <div>
            파일 <b>{num(fileCount)}</b>개 (변경 <b>{num(changedCount)}</b>)
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <div className="metric" title="완전히 일치한 줄 ÷ 더 긴 쪽 줄 수">
          <span className="k">라인 유사도</span>
          <span className="v" style={{ color: simColor(stats.lineSimilarity) }}>
            {pct(stats.lineSimilarity)}
          </span>
        </div>
        <div className="metric" title="(2 × 일치 줄) ÷ (이전 줄 + 이후 줄) — Dice 계수">
          <span className="k">Dice 계수</span>
          <span className="v" style={{ color: simColor(stats.diceSimilarity) }}>
            {pct(stats.diceSimilarity)}
          </span>
        </div>
        <div className="metric" title="수정된 줄 안의 부분 일치까지 문자 단위로 반영">
          <span className="k">문자 유사도</span>
          <span className="v" style={{ color: simColor(stats.charSimilarity) }}>
            {pct(stats.charSimilarity)}
          </span>
        </div>
        <div className="metric" title="1 − 라인 유사도">
          <span className="k">변경률</span>
          <span className="v" style={{ color: simColor(1 - stats.changeRatio) }}>
            {pct(stats.changeRatio)}
          </span>
        </div>
        <div className="metric" title={leftLabel}>
          <span className="k">이전 총 줄 수</span>
          <span className="v" style={{ color: 'var(--del-fg)' }}>
            {num(stats.aLines)}
          </span>
        </div>
        <div className="metric" title={rightLabel}>
          <span className="k">이후 총 줄 수</span>
          <span className="v" style={{ color: 'var(--add-fg)' }}>
            {num(stats.bLines)}
          </span>
        </div>
      </div>

      {stats.ignored > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--faint)' }}>
          비교 제외 {num(stats.ignored)}줄 (빈 줄/주석 무시 옵션)
        </div>
      )}
    </div>
  )
}
