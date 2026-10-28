#!/usr/bin/env bash
# 롤백 — 배포 서버에 ssh 로 붙어 정해 둔 되돌리기 명령(ROLLBACK_CMD)을 실행한다. 빌드 · 전송은 하지 않는다.
#
# 사용:  shl/deploy-rollback.sh
#   (윈도우 PowerShell · cmd 에서는 shl\deploy-rollback.cmd)
#
# 설정은 deploy.sh 와 같은 change/deploy.env — 같은 서버(SSH_*) · 같은 폴더(REMOTE_DIR)에서 ROLLBACK_CMD 를 돌린다.
# 없으면 shl/deploy.env.example 을 복사해 만들고 멈춘다.
#
# 저장소 루트의 rollback.sh 는 서버에서 도는 스크립트이고, 이것은 PC 에서 그것을 부르는 쪽이다.
set -euo pipefail

SHL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SHL_DIR")"
ENV_FILE="$ROOT_DIR/change/deploy.env"
ENV_EXAMPLE="$SHL_DIR/deploy.env.example"

die() { echo "오류: $*" >&2; exit 1; }

usage() {
  sed -n '3,5p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ── 인자 ───────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "모르는 인자입니다: $arg" ;;
  esac
done

# ── 설정 ───────────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  die "설정 파일이 없어 예시로 만들었습니다 — $ENV_FILE 을 채운 뒤 다시 실행하세요."
fi
# shellcheck source=/dev/null
. "$ENV_FILE"

require() {
  [ -n "$2" ] || die "$ENV_FILE 에 $1 이 비어 있습니다."
}

require SSH_HOST "${SSH_HOST:-}"
require REMOTE_DIR "${REMOTE_DIR:-}"
require ROLLBACK_CMD "${ROLLBACK_CMD:-}"

# ── 서버 명령 ──────────────────────────────────────────────────────────
# 원격 셸이 해석할 문자열이라 작은따옴표로 감싸고 안의 ' 는 '\'' 로 바꾼다
shell_quote() {
  printf "'%s'" "${1//\'/\'\\\'\'}"
}

# 앞의 ~ 는 원격에서 홈으로 풀려야 하므로 따옴표 밖에 둔다 (server/source/sshCommands.ts 와 같은 규칙)
quote_remote_dir() {
  case "$1" in
    "~") printf '~' ;;
    "~/"*) printf '~/%s' "$(shell_quote "${1#\~/}")" ;;
    *) shell_quote "$1" ;;
  esac
}

ssh_args=(-o ConnectTimeout=10 -o StrictHostKeyChecking=yes)
if [ -n "${SSH_PORT:-}" ]; then ssh_args+=(-p "$SSH_PORT"); fi
if [ -n "${SSH_IDENTITY:-}" ]; then ssh_args+=(-i "$SSH_IDENTITY"); fi
target="${SSH_USER:+$SSH_USER@}$SSH_HOST"

# ROLLBACK_CMD 는 설정에 쓴 그대로 원격 셸에 맡긴다 (&& · ; 를 쓸 수 있게 따옴표로 감싸지 않는다)
echo "서버에서 실행: $target:$REMOTE_DIR — $ROLLBACK_CMD" >&2
set +e
ssh "${ssh_args[@]}" "$target" "cd $(quote_remote_dir "$REMOTE_DIR") && $ROLLBACK_CMD" < /dev/null
status=$?
set -e

[ "$status" -eq 0 ] || die "롤백 명령이 실패했습니다 (종료 코드 $status)."
echo "완료: $target:$REMOTE_DIR" >&2
