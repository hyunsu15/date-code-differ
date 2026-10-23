interface SameFoldProps {
  /** 접어 둔(또는 검색에 걸린) 동일한 항목 수 */
  count: number
  open: boolean
  /** 검색 중인가 — 그때는 접기와 상관없이 맞는 것을 다 보여주고 접기 버튼을 두지 않는다 */
  searching: boolean
  /** `파일` · `테이블` */
  noun: string
  onToggle: () => void
}

/**
 * 목록 맨 아래의 **동일한 항목 접힘 줄** — 코드 파일 목록과 스키마 테이블 목록이 같이 쓴다.
 *
 * 예전에는 목록 위 "변경된 파일만" 체크박스로 동일한 것을 숨겼다. 바뀐 것을 위로 올리는 정렬이
 * 생기면서 그 체크는 "아래쪽 동일한 것들을 보일지" 만 정하게 됐고, 그건 목록 안에서 접고 펴는 편이
 * 자연스럽다 — 화면의 다른 접기("제외 N" · "동일한 N줄 접힘" · 날짜 "N개 숨김")와 같은 방식이다.
 *
 *   평소     ▾ 동일한 파일 8개 — 펼치기   /   ▴ 동일한 파일 8개 — 접기
 *   검색 중  동일한 파일 중 3개            (아래에 맞는 것이 펼쳐져 있다)
 *
 * 동일한 것이 없으면(검색 중 맞는 것이 없으면) 아무것도 그리지 않는다.
 */
export default function SameFold({ count, open, searching, noun, onToggle }: SameFoldProps) {
  if (count === 0) return null

  if (searching) {
    return <div className="same-fold searching">동일한 {noun} 중 {count.toLocaleString('ko-KR')}개</div>
  }

  return (
    <button type="button" className="same-fold" onClick={onToggle} aria-expanded={open}>
      <span>{open ? '▴' : '▾'}</span>
      <span>
        동일한 {noun} {count.toLocaleString('ko-KR')}개 — {open ? '접기' : '펼치기'}
      </span>
    </button>
  )
}
