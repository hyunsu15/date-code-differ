import { useEffect } from 'react'

/**
 * 단축키 — App 의 keydown 처리와 같은 내용이어야 한다 (`App.tsx` 의 "단축키" 절).
 * 툴팁에 흩어져 있으면 마우스를 올려 본 버튼의 것만 알게 된다.
 */
const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['n', 'j', 'Alt+↓'], what: '다음 diff 포인트' },
  { keys: ['p', 'k', 'Alt+↑'], what: '이전 diff 포인트' },
  { keys: [']', '['], what: '다음 / 이전 파일' },
  { keys: ['/'], what: '파일 경로 검색으로 이동' },
  { keys: ['u'], what: '나란히 ↔ 통합 보기' },
  { keys: ['Alt+A'], what: '변경만 ↔ 전체 코드' },
  { keys: ['Alt+S'], what: '좌우 동기 스크롤 켜기 / 끄기' },
  { keys: ['Ctrl+F'], what: '코드에서 찾기' },
  { keys: ['F3', 'Shift+F3'], what: '다음 / 이전 찾은 곳' },
  { keys: ['Esc'], what: '찾기 · 메뉴 · 창 닫기' },
  { keys: ['?'], what: '이 도움말' },
]

interface HelpPanelProps {
  onClose: () => void
}

/**
 * 도움말 — 화면 흐름 · 표시 읽는 법 · 단축키.
 *
 * 설명서(`docs/사용설명서.md`)는 길고 앱과 떨어져 있어 처음 온 사람이 열어 보지 않는다.
 * 여기에는 "처음 5분" 에 필요한 것만 둔다.
 */
export default function HelpPanel({ onClose }: HelpPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="settings help"
        role="dialog"
        aria-modal="true"
        aria-label="도움말"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <b>도움말</b>
          <button type="button" className="btn sm" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        <div className="settings-body">
          <h4 className="settings-section">이렇게 봅니다</h4>
          <ol className="help-steps">
            <li>
              <b>위에서 좌우를 고릅니다.</b> 칸마다 환경(운영 · 테스트)과 날짜가 있습니다. 같은 환경이면
              날짜 칸에 <b>변경 이력</b>(이전 → 이후 한 쌍)이 먼저 나옵니다. 왼쪽 <b>일주일</b> 은 최신 ↔ 7일 전을
              한 번에 고릅니다.
            </li>
            <li>
              <b>왼쪽 목록에서 바뀐 파일을 고릅니다.</b> 바뀐 것이 위, 동일한 것은 맨 아래 한 줄로 접혀
              있습니다. 위 패키지 칩을 누르면 그 패키지만 봅니다.
            </li>
            <li>
              <b>가운데에서 diff 를 봅니다.</b> <kbd>n</kbd> / <kbd>p</kbd> 로 바뀐 곳을 차례로 옮겨
              다닙니다.
            </li>
          </ol>

          <h4 className="settings-section">표시 읽는 법</h4>
          <ul className="help-legend">
            <li>
              <span className="del">−</span> 지운 줄 · <span className="add">+</span> 더한 줄 ·{' '}
              <span className="mod">~</span> 고친 줄
            </li>
            <li>
              <b>유사도</b> — 완전히 일치한 줄 ÷ 더 긴 쪽 줄 수. 왼쪽 위 "자세히" 에 다른 지표가 있습니다.
            </li>
            <li>
              <b>보기 옵션 · 무시 N</b> — 공백 · 주석처럼 비교에서 뺀 것의 수. 끄면 그만큼 차이가 더
              보입니다.
            </li>
            <li>
              <b>⊘</b> — 파일을 내 제외 목록에 넣어 접습니다. 되돌리기는 알림에서, 관리는{' '}
              <b>⚙ 설정 → 제외 규칙</b> 에서 합니다.
            </li>
          </ul>

          <h4 className="settings-section">단축키</h4>
          <table className="help-keys">
            <tbody>
              {SHORTCUTS.map((s) => (
                <tr key={s.what}>
                  <td>
                    {s.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && ' · '}
                        <kbd>{k}</kbd>
                      </span>
                    ))}
                  </td>
                  <td>{s.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="settings-note">
            입력칸에 글자를 넣는 중에는 한 글자 단축키가 동작하지 않습니다 (Alt · Ctrl 조합은 동작).
            <br />
            더 자세한 설명은 저장소의 <code>docs/사용설명서.md</code> 에 있습니다.
          </p>
        </div>
      </div>
    </div>
  )
}
