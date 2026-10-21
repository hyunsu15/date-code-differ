/**
 * 글을 파일로 내려받게 한다.
 *
 * 서버를 거치지 않는다 — 내용은 이미 화면이 들고 있고, 서버에 보냈다 받으면 접속만 하나 는다.
 * BOM 을 붙인다: 없으면 윈도우 메모장 일부 버전이 한글 md 를 ANSI 로 읽어 깨뜨린다.
 */
export function downloadText(fileName: string, text: string, type = 'text/markdown'): void {
  const blob = new Blob(['﻿', text], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 클릭이 내려받기를 시작한 뒤에 풀어야 한다 — 바로 풀면 일부 브라우저에서 빈 파일이 된다
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
