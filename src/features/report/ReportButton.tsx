import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ReportKind } from './report.ts'

/** 고를 수 있는지, 못 고르면 왜인지 — 잠긴 이유가 보여야 한다 */
export interface ReportOption {
  ok: boolean
  /** 고를 수 없을 때 보여줄 이유 */
  reason: string
  /** 무엇이 담기는지 한 줄 */
  hint: string
}

interface ReportButtonProps {
  /** 본 버튼이 받을 보고서 — 마지막으로 고른 것 (`reportPreference.ts`) */
  primary: ReportKind
  /** 지금 탭 — 메뉴에 `지금 탭` 으로 표시만 한다 */
  tab: Exclude<ReportKind, 'all'>
  options: Record<ReportKind, ReportOption>
  /** 만드는 중 (스키마를 읽는 동안) */
  busy: boolean
  /** 본 버튼 — 그대로 받는다 */
  onDownload: (kind: ReportKind) => void
  /** 메뉴에서 고름 — 받고, 그 종류를 본 버튼으로 삼는다 */
  onPick: (kind: ReportKind) => void
}

const LABEL: Record<ReportKind, string> = {
  code: '소스 보고서',
  schema: '스키마 보고서',
  all: '통합 보고서',
}

/** 메뉴 순서 — 통합을 맨 위에. 가장 많이 받는 것이라 메뉴를 열면 바로 포커스가 간다 */
const ORDER: ReportKind[] = ['all', 'code', 'schema']

/** 메뉴 폭 (`styles.css` 의 `.report-menu` 와 같게) — 어느 쪽으로 열지 가를 때 쓴다 */
const MENU_WIDTH = 280

/**
 * 보고서 내려받기 — **나뉜 버튼**(본 버튼 + ▾).
 *
 * 본 버튼은 **마지막으로 고른 보고서**(처음은 통합)를 한 번에 받고, ▾ 메뉴에서 다른 것을
 * 고르면 받으면서 그게 본 버튼이 된다 — GitHub 병합 버튼과 같은 방식. 본 버튼의 글자가
 * **지금 무엇을 받는지** 늘 말해 주니 바뀌어도 헷갈리지 않는다.
 *
 * 예전에는 본 버튼이 지금 탭을 따라갔다. 그런데 가장 많이 받는 것이 통합이라 거의 매번
 * ▾ 를 눌러야 했다. 탭 정보는 메뉴에 `지금 탭` 으로만 남긴다.
 *
 * 메뉴 세 개를 늘 펼쳐 두지 않은 것은 헤더 폭 때문이고, 메뉴만 두지 않은 것은 흔한 일에
 * 클릭을 두 번 시키지 않기 위해서다.
 *
 * 고를 수 없는 항목은 지우지 않고 잠근 채 이유를 적는다 — 없어진 줄 알고 찾게 만들지 않는다.
 */
export default function ReportButton({
  primary,
  tab,
  options,
  busy,
  onDownload,
  onPick,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const caretRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // 바깥을 누르거나 Esc 면 닫는다 (DiffNav 의 "목록에서 선택" 과 같은 규칙)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  /**
   * 메뉴를 어느 쪽에 맞춰 열지. 보통은 헤더 오른쪽 끝이라 오른쪽에 맞추지만,
   * 좁은 화면에서 헤더가 접혀 버튼이 왼쪽으로 내려오면 그대로 열면 화면 밖으로 나간다.
   */
  const [alignLeft, setAlignLeft] = useState(false)
  const toggle = (): void => {
    const rect = wrapRef.current?.getBoundingClientRect()
    setAlignLeft(Boolean(rect && rect.right < MENU_WIDTH + 12))
    setOpen((v) => !v)
  }

  // 열리면 첫 번째로 고를 수 있는 항목에 포커스 — 키보드로 바로 고르게
  useEffect(() => {
    if (!open) return
    const first = ORDER.findIndex((k) => options[k].ok)
    itemRefs.current[first >= 0 ? first : 0]?.focus()
  }, [open, options])

  const close = (): void => {
    setOpen(false)
    caretRef.current?.focus()
  }

  const pick = (kind: ReportKind): void => {
    setOpen(false)
    onPick(kind)
  }

  /** ↑↓ 로 고를 수 있는 항목 사이를 돈다. Esc 는 닫고 ▾ 로 돌아간다 */
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const enabled = ORDER.map((k, i) => (options[k].ok ? i : -1)).filter((i) => i >= 0)
    if (enabled.length === 0) return
    const at = enabled.indexOf(itemRefs.current.findIndex((el) => el === document.activeElement))
    const step = e.key === 'ArrowDown' ? 1 : -1
    const next = enabled[(at + step + enabled.length) % enabled.length]
    itemRefs.current[next]?.focus()
  }

  const main = options[primary]

  return (
    <div className="report-split btn-group" ref={wrapRef}>
      <button
        type="button"
        className="btn sm"
        onClick={() => onDownload(primary)}
        disabled={!main.ok || busy}
        title={main.ok ? `${main.hint}\n.md 파일로 내려받습니다` : main.reason}
      >
        {busy ? '⬇ 만드는 중…' : `⬇ ${LABEL[primary]}`}
      </button>
      <button
        type="button"
        ref={caretRef}
        className="btn sm report-caret"
        onClick={toggle}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="보고서 종류 고르기"
        title="다른 보고서 고르기 (통합 · 소스 · 스키마) — 고른 것이 버튼에 남습니다"
      >
        ▾
      </button>

      {open && (
        <div
          className={`report-menu${alignLeft ? ' align-left' : ''}`}
          role="menu"
          aria-label="보고서 종류"
          onKeyDown={onMenuKey}
        >
          {ORDER.map((kind, i) => {
            const option = options[kind]
            return (
              <button
                key={kind}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                type="button"
                role="menuitemradio"
                aria-checked={kind === primary}
                className="report-item"
                disabled={!option.ok}
                onClick={() => pick(kind)}
              >
                <span className="name">
                  <span className="check" aria-hidden="true">
                    {kind === primary ? '✓' : ''}
                  </span>
                  {LABEL[kind]}
                  {kind === tab && <span className="here">지금 탭</span>}
                </span>
                <span className="desc">{option.ok ? option.hint : option.reason}</span>
              </button>
            )
          })}
          {/* 고르면 버튼이 바뀐다는 것을 미리 알려 둔다 — 모르고 고르면 버튼 글자가 왜 바뀌었는지 헷갈린다 */}
          <div className="report-foot">고른 보고서가 버튼에 남습니다</div>
        </div>
      )}
    </div>
  )
}
