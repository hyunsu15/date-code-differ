interface AllSameNoticeProps {
  /** 접혀 있는 동일한 항목 수 */
  count: number
  /** 무엇인가 — 코드는 "파일", 스키마는 "테이블" (둘 다 받침이 있어 조사는 "이") */
  noun: string
  /** 제외로 접혀 세지 않은 수. 그 안에 바뀐 것이 있을 수 있어 0 이 아니면 함께 적는다 */
  excluded: number
  /**
   * 같은 날짜끼리 견주는 중이면 그 날짜 — 지난주 프리셋이 "그 주엔 새 폴더가 없었다" 를 보여줄 때.
   * 왜 다 같은지를 먼저 말해야 "비교가 고장 났나" 로 읽히지 않는다.
   */
  sameDate?: string | null
  /** 동일한 것을 펼친다 — 목록 맨 아래 접힘 줄을 누른 것과 같다 */
  onOpen: () => void
}

/**
 * 바뀐 것이 하나도 없을 때 본문 자리 안내 — 코드 파일과 스키마 테이블이 같이 쓴다.
 *
 * 동일한 것은 목록 맨 아래 한 줄로 접혀 있어서, 다 같으면 목록도 본문도 비어 보인다.
 * "비교할 파일을 고르세요" 라고 하면 고를 것이 없는데 고르라는 말이 되므로,
 * **다 같다는 것과 펼쳐 보는 법**을 적고 같은 일을 하는 버튼을 바로 둔다(목록을 숨겼어도 펼칠 수 있게).
 */
export default function AllSameNotice({ count, noun, excluded, sameDate, onOpen }: AllSameNoticeProps) {
  const n = count.toLocaleString('ko-KR')
  return (
    <div className="empty" role="status">
      <h2>바뀐 {noun}이 없습니다</h2>
      <p>
        {sameDate && (
          <>
            같은 날짜(<b>{sameDate}</b>)끼리 견주고 있습니다 — 그 사이 새 날짜 폴더가 없었습니다.
            <br />
          </>
        )}
        견준 {noun} {n}개가 모두 동일합니다.
        <br />
        내용을 보려면 왼쪽 목록 맨 아래 <b>▾ 동일한 {noun} {n}개 — 펼치기</b> 를 누르세요.
        {excluded > 0 && (
          <>
            <br />
            제외로 접힌 {noun} {excluded.toLocaleString('ko-KR')}개는 세지 않았습니다.
          </>
        )}
      </p>
      <button type="button" className="btn primary" onClick={onOpen}>
        ▾ 동일한 {noun} {n}개 펼치기
      </button>
    </div>
  )
}
