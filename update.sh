#!/usr/bin/env bash
# blue-green 스왑 배포: *_next(새 빌드) → 운영 디렉토리, 기존 운영본은 *_prev 로 보존.
# 대상: backend(백엔드 번들), dist(프론트 빌드) — 있는 것만 스왑한다(하나만 배포해도 동작).
# 사용: 운영 디렉토리와 같은 위치에 두고 실행. 복원은 rollback.sh.
set -euo pipefail
cd "$(dirname "$0")"

swapped=0

swap_next_to_current() {
  local name="$1"
  if [ ! -d "${name}_next" ]; then
    return
  fi
  rm -rf "${name}_prev"
  if [ -d "$name" ]; then
    mv "$name" "${name}_prev"
  fi
  mv "${name}_next" "$name"
  echo "업데이트: ${name}_next → ${name} (이전 버전은 ${name}_prev 에 보존)"
  swapped=1
}

# swap_next_to_current backend
swap_next_to_current dist

if [ "$swapped" -eq 0 ]; then
  echo "오류: backend_next 도 dist_next 도 없습니다 — 새 빌드 산출물을 먼저 복사하세요." >&2
  exit 1
fi
