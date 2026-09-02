import { useSyncExternalStore } from 'react'
import { dismissToast, getToasts, subscribeToasts, type Toast } from '../../lib/toast.ts'

const ICON: Record<Toast['kind'], string> = {
  error: '⚠',
  warn: '⚠',
  info: 'ℹ',
}

/**
 * 화면 오른쪽 아래에 쌓이는 알림.
 *
 * 오류는 **닫아야 사라진다** (`lib/toast.ts` 참고). 자세한 내용은 접지 않고 그대로 편다 —
 * 원인을 짚어 주는 문장이라 한 번 더 눌러야 보이면 안 읽는다.
 */
export default function Toasts() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts)
  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast t-${toast.kind}`}>
          <span className="icon" aria-hidden="true">
            {ICON[toast.kind]}
          </span>

          <div className="body">
            <b className="title">{toast.title}</b>
            {toast.detail && <div className="detail">{toast.detail}</div>}
          </div>

          <button
            type="button"
            className="close"
            onClick={() => dismissToast(toast.id)}
            title="닫기"
            aria-label="알림 닫기"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
