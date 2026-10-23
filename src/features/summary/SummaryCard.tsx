import { useState } from 'react'
import { num, pct, simColor } from '../../lib/format.ts'
import type { DiffStats } from '../../types.ts'

interface SummaryCardProps {
  stats: DiffStats
  fileCount: number
  /** 바뀐(추가·삭제·변경) 파일 수 */
  changedCount: number
  leftLabel: string
  rightLabel: string
  loading: boolean
}

const OPEN_KEY = 'cd-summary-open'

/** 자세히를 펼쳐 둔 채였는지 — 이 브라우저에만 남는 편의값이라 못 읽으면 접은 채로 둔다 */
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'on'
  } catch {
    return false
  }
}

function saveOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? 'on' : 'off')
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장이 없다
  }
}

/**
 * 두 스냅샷 전체의 유사도 요약.
 * 유사도 = 완전히 일치한 줄 수 / 더 긴 쪽의 줄 수  ← "줄 갯수 대비 diff"
 *
 * **처음에는 한 줄로 접혀 있다.** 사이드바의 본 일은 파일 목록인데, 지표 6칸이 펼쳐져 있으면
 * 목록이 화면 아래로 밀려 파일이 몇 개 안 보였다. 대표 값(라인 유사도 · 줄 증감 · 파일 수)만
 * 늘 보이고, 나머지 지표는 "자세히" 로 편다.
 */
export default function SummaryCard({
  stats,
  fileCount,
  changedCount,
  leftLabel,
  rightLabel,
  loading,
}: SummaryCardProps) {
  const [open, setOpen] = useState(readOpen)
  const toggle = (): void => {
    saveOpen(!open)
    setOpen(!open)
  }

  return (
    <div className="summary">
      <div className="summary-line">
        <span className="sim-block" title="전체 라인 유사도 — 완전히 일치한 줄 ÷ 더 긴 쪽 줄 수">
          <span className="sim-big" style={{ color: simColor(stats.lineSimilarity) }}>
            {(stats.lineSimilarity * 100).toFixed(0)}%
          </span>
          <span className="sim-cap">유사도</span>
        </span>
        <div className="summary-meta">
          <div>
            <span style={{ color: 'var(--del-fg)' }}>−{num(stats.removed)}</span>{' '}
            <span style={{ color: 'var(--add-fg)' }}>+{num(stats.added)}</span>{' '}
            <span style={{ color: 'var(--mod-fg)' }}>~{num(stats.modified)}</span>
            {loading && <span className="summary-busy"> · 계산 중…</span>}
          </div>
          <div>
            파일 <b>{num(fileCount)}</b>개 (변경 <b>{num(changedCount)}</b>)
          </div>
        </div>
        <button
          type="button"
          className="summary-toggle"
          onClick={toggle}
          aria-expanded={open}
          title={open ? '지표 접기' : '유사도 지표 더 보기'}
        >
          자세히 {open ? '▴' : '▾'}
        </button>
      </div>

      {open && (
        <>
          <div className="summary-sub">
            일치 <b>{num(stats.same)}</b>줄 / 비교{' '}
            <b>{num(Math.max(stats.comparedA, stats.comparedB))}</b>줄
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
            <div className="metric" title="바뀐 줄 안의 부분 일치까지 문자 단위로 반영">
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
            <div className="summary-sub">
              비교 제외 {num(stats.ignored)}줄 (빈 줄·주석·작성자·죽은 코드 무시 옵션)
            </div>
          )}
        </>
      )}
    </div>
  )
}
