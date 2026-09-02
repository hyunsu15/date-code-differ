/**
 * 화면 어디서든 띄울 수 있는 알림.
 *
 * 인라인 배너만으로는 **놓친다.** 배너는 화면 위쪽에 조용히 끼어들 뿐이라, 아래쪽
 * 목록을 보고 있으면 실패한 줄도 모른 채 "왜 비어 있지" 만 하게 된다. 실패는 눈앞으로
 * 와야 한다.
 *
 * **오류는 저절로 사라지지 않는다.** 잠깐 떴다 사라지면 못 본 것과 같다 —
 * 사람이 직접 닫아야 없어진다. 정보성 알림만 시간이 지나면 접힌다.
 *
 * React 밖에 두는 이유: 알림을 띄우는 자리(효과 안·응답 처리 안)와 그리는 자리가
 * 멀리 떨어져 있어서, 프롭으로 나르면 중간 컴포넌트가 전부 이 일을 알아야 한다.
 */

export type ToastKind = 'error' | 'warn' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  /** 한 줄 요약 */
  title: string
  /** 원문 오류·못 읽은 줄 등. 여러 줄이어도 된다 */
  detail?: string
}

/** 정보성 알림이 저절로 접히기까지 (ms). 오류·경고는 접히지 않는다 */
const AUTO_DISMISS_MS = 6_000

let sequence = 0
let items: readonly Toast[] = []
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** `useSyncExternalStore` 가 쓰는 스냅샷 — 바뀔 때만 새 배열이 나온다 */
export function getToasts(): readonly Toast[] {
  return items
}

export function dismissToast(id: number): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  const next = items.filter((t) => t.id !== id)
  if (next.length === items.length) return
  items = next
  emit()
}

export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  if (items.length === 0) return
  items = []
  emit()
}

/**
 * 알림을 띄운다.
 *
 * **같은 내용이 이미 떠 있으면 다시 띄우지 않는다.** 효과가 두 번 도는 것만으로
 * 같은 오류가 두 장 쌓이면 사람은 새 오류가 또 났다고 읽는다.
 *
 * @returns 띄운(또는 이미 떠 있던) 알림의 id
 */
export function pushToast(kind: ToastKind, title: string, detail?: string): number {
  const existing = items.find((t) => t.kind === kind && t.title === title && t.detail === detail)
  if (existing) return existing.id

  sequence += 1
  const toast: Toast = { id: sequence, kind, title, detail }
  items = [...items, toast]
  emit()

  // 오류는 사람이 닫을 때까지 남는다 — 잠깐 떴다 사라지면 못 본 것과 같다
  if (kind === 'info') {
    timers.set(
      toast.id,
      setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS)
    )
  }
  return toast.id
}
