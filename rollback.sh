#!/usr/bin/env bash
# blue-green 롤백: *_prev(이전 버전) → 운영 디렉토리, 문제 버전은 *_next 로 보존(삭제 안 함).
# 대상: backend(백엔드 번들), dist(프론트 빌드) — 있는 것만 복원한다.
# 사용: update.sh 와 같은 위치에서 실행.
set -euo pipefail
cd "$(dirname "$0")"

restored=0

swap_prev_to_current() {
  local name="$1"
  if [ ! -d "${name}_prev" ]; then
    return
  fi
  rm -rf "${name}_next"
  if [ -d "$name" ]; then
    mv "$name" "${name}_next"
  fi
  mv "${name}_prev" "$name"
  echo "롤백: ${name}_prev → ${name} (문제 버전은 ${name}_next 에 보존)"
  restored=1
}

# swap_prev_to_current backend
swap_prev_to_current dist

if [ "$restored" -eq 0 ]; then
  echo "오류: backend_prev 도 dist_prev 도 없습니다 — 롤백할 이전 버전이 없습니다." >&2
  exit 1
fi
