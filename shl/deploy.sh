#!/usr/bin/env bash
# 배포 — 내 PC 에서 빌드하고, SSH 로 빌드 결과를 서버에 옮긴 뒤, 서버에서 정해 둔 명령을 실행한다.
#
# 사용:  shl/deploy.sh [--skip-build] [--no-run]
#   shl/deploy.sh                빌드 → 옮기기 → 서버 명령 (REMOTE_CMD)
#   shl/deploy.sh --skip-build   이미 만든 빌드를 그대로 옮긴다
#   shl/deploy.sh --no-run       옮기기만 하고 서버 명령은 실행하지 않는다
#   (윈도우 PowerShell · cmd 에서는 shl\deploy.cmd 에 같은 인자)
#
# 설정은 change/deploy.env (커밋하지 않음) — SSH · 빌드 명령 · 옮길 것 · 서버 폴더 · 서버 명령.
# 없으면 shl/deploy.env.example 을 복사해 만들고 멈춘다.
#
# 서버에는 임시 폴더로 다 받은 뒤 이름을 바꾼다 — 전송이 끊겨도 서버의 기존 파일은 그대로다.
set -euo pipefail

SHL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SHL_DIR")"
ENV_FILE="$ROOT_DIR/change/deploy.env"
ENV_EXAMPLE="$SHL_DIR/deploy.env.example"

die() { echo "오류: $*" >&2; exit 1; }

usage() {
  sed -n '3,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ── 인자 ───────────────────────────────────────────────────────────────
skip_build=0
no_run=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) skip_build=1 ;;
    --no-run) no_run=1 ;;
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
require DEPLOY_FILES "${DEPLOY_FILES:-}"
require REMOTE_DIR "${REMOTE_DIR:-}"
[ "$skip_build" -eq 1 ] || require BUILD_CMD "${BUILD_CMD:-}"

# 비우면 저장소 루트, 상대 경로는 저장소 루트 기준
case "${BUILD_DIR:-}" in
  "") build_dir="$ROOT_DIR" ;;
  /* | [A-Za-z]:*) build_dir="$BUILD_DIR" ;;
  *) build_dir="$ROOT_DIR/$BUILD_DIR" ;;
esac
[ -d "$build_dir" ] || die "BUILD_DIR 폴더가 없습니다: $build_dir"

# 서버에서 rm -rf 할 이름이므로 맨 위 단계 이름만 받는다 — / · .. 가 들어가면 운영 폴더 밖을 지울 수 있다
read -ra deploy_files <<< "$DEPLOY_FILES"
for name in "${deploy_files[@]}"; do
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] && [ "$name" != "." ] && [ "$name" != ".." ] ||
    die "DEPLOY_FILES 에는 BUILD_DIR 바로 아래 이름만 적습니다 (/ · .. 불가): $name"
done

# ── 빌드 ───────────────────────────────────────────────────────────────
if [ "$skip_build" -eq 0 ]; then
  echo "빌드 중: $BUILD_CMD" >&2
  (cd "$build_dir" && bash -c "$BUILD_CMD") || die "빌드에 실패했습니다. 서버에는 아무것도 옮기지 않았습니다."
fi

for name in "${deploy_files[@]}"; do
  [ -e "$build_dir/$name" ] || die "옮길 것이 없습니다: $name — 빌드 결과인지, DEPLOY_FILES 가 맞는지 확인하세요."
done

# ── 옮기기 ─────────────────────────────────────────────────────────────
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

dir_q="$(quote_remote_dir "$REMOTE_DIR")"
tmp_dir=".deploy.tmp"

# 임시 폴더에 다 풀린 뒤에만 기존 것을 지우고 바꿔 끼운다
remote_cmd="mkdir -p $dir_q && cd $dir_q && rm -rf $tmp_dir && mkdir $tmp_dir"
remote_cmd+=" && { tar -xzf - --no-same-owner -C $tmp_dir || { rm -rf $tmp_dir; exit 1; }; }"
for name in "${deploy_files[@]}"; do
  name_q="$(shell_quote "$name")"
  remote_cmd+=" && rm -rf $name_q && mv $tmp_dir/$name_q $name_q"
done
remote_cmd+=" && rmdir $tmp_dir"

echo "옮기는 중: ${deploy_files[*]} → $target:$REMOTE_DIR" >&2
set +e
(cd "$build_dir" && tar -czf - "${deploy_files[@]}") | ssh "${ssh_args[@]}" "$target" "$remote_cmd"
status=$?
set -e
[ "$status" -eq 0 ] || die "옮기기에 실패했습니다 (종료 코드 $status). 서버 명령은 실행하지 않았습니다."

if [ "$no_run" -eq 1 ] || [ -z "${REMOTE_CMD:-}" ]; then
  echo "완료: 옮기기만 했습니다 — $target:$REMOTE_DIR" >&2
  exit 0
fi

# ── 서버 명령 ──────────────────────────────────────────────────────────
# REMOTE_CMD 는 설정에 쓴 그대로 원격 셸에 맡긴다 (&& · ; 를 쓸 수 있게 따옴표로 감싸지 않는다)
echo "서버에서 실행: $REMOTE_CMD" >&2
set +e
ssh "${ssh_args[@]}" "$target" "cd $dir_q && $REMOTE_CMD" < /dev/null
status=$?
set -e

if [ "$status" -ne 0 ]; then
  echo "파일은 이미 옮겨졌습니다. 이전 버전으로 되돌리려면 shl/deploy-rollback.sh (윈도우는 shl\deploy-rollback.cmd)" >&2
  die "서버 명령이 실패했습니다 (종료 코드 $status)."
fi

echo "완료: $target:$REMOTE_DIR" >&2
