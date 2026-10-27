#!/usr/bin/env bash
# 스키마 덤프 — 내 PC 에서 Oracle 딕셔너리를 조회해 txt 로 만들고, SSH 로 서버의 스키마 폴더에 올린다.
#
# 사용:  shl/schema-dump.sh <환경> [날짜] [--force]
#   shl/schema-dump.sh prod              오늘 날짜로 snapshot_prod_2026-10-27.txt
#   shl/schema-dump.sh test 2026-10-20   날짜를 직접 준다
#   shl/schema-dump.sh prod --force      같은 이름 파일이 서버에 있어도 덮어쓴다
#   (윈도우 PowerShell · cmd 에서는 shl\schema-dump.cmd 에 같은 인자)
#
# 왜 PC 에서 도는가: DB 는 내 PC 에서만 붙고, 서버는 DB 에 못 붙는다.
# 그래서 조회는 PC 가 하고 서버는 파일만 받는다. 웹 도구(배포본)는 지금처럼 읽기만 한다.
#
# 설정은 change/schema-dump.env (커밋하지 않음) — 웹 도구의 change/config.ts 와 한곳에 둔다.
# 따로 지정하지 않아도 이 스크립트 위치에서 찾는다. 없으면 shl/schema-dump.env.example 을 복사해 만들고 멈춘다.
# DB 비밀번호는 실행할 때마다 묻고 어디에도 저장하지 않는다 — sqlplus 에는 명령줄이 아니라
# 표준입력으로 넘겨서 작업 관리자 · ps 에도 보이지 않는다.
#
# 만든 파일은 shl/out/ 에도 남긴다. 업로드가 실패해도 그 파일을 손으로 올리면 된다.
set -euo pipefail

SHL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$(dirname "$SHL_DIR")/change/schema-dump.env"
ENV_EXAMPLE="$SHL_DIR/schema-dump.env.example"
SQL_FILE="$(dirname "$SHL_DIR")/change/check_table.sql"
OUT_DIR="$SHL_DIR/out"

# 원격에서 "같은 이름 파일이 이미 있다" 를 알리는 종료 코드 — ssh 자체 실패(255)와 가르려고 따로 둔다
EXIT_EXISTS=3

die() { echo "오류: $*" >&2; exit 1; }

usage() {
  sed -n '3,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ── 인자 ───────────────────────────────────────────────────────────────
force=0
positional=()
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    -h | --help) usage; exit 0 ;;
    -*) die "모르는 옵션입니다: $arg" ;;
    *) positional+=("$arg") ;;
  esac
done

if [ "${#positional[@]}" -lt 1 ] || [ "${#positional[@]}" -gt 2 ]; then
  usage >&2
  exit 1
fi

env_id="${positional[0]}"
snap_date="${positional[1]:-$(date +%F)}"

[[ "$env_id" =~ ^[A-Za-z0-9_]+$ ]] || die "환경 이름은 영문 · 숫자 · _ 만 됩니다: $env_id"
[[ "$snap_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "날짜는 YYYY-MM-DD 로 적습니다: $snap_date"

# ── 설정 ───────────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  die "설정 파일이 없어 예시로 만들었습니다 — $ENV_FILE 을 채운 뒤 다시 실행하세요."
fi
# shellcheck source=/dev/null
. "$ENV_FILE"

prefix="$(printf '%s' "$env_id" | tr '[:lower:]' '[:upper:]')"

# 환경 묶음의 값 하나 — prod 의 DB_USER 는 PROD_DB_USER
env_value() {
  local name="${prefix}_$1"
  printf '%s' "${!name:-}"
}

require() {
  [ -n "$2" ] || die "$ENV_FILE 에 $1 이 비어 있습니다."
}

db_connect="$(env_value DB_CONNECT)"
db_user="$(env_value DB_USER)"
db_owner="$(env_value DB_OWNER | tr '[:lower:]' '[:upper:]')"
remote_dir="$(env_value REMOTE_DIR)"

require "${prefix}_DB_CONNECT" "$db_connect"
require "${prefix}_DB_USER" "$db_user"
require "${prefix}_REMOTE_DIR" "$remote_dir"
require SSH_HOST "${SSH_HOST:-}"

# SQL 의 &owner 로 들어갈 소유자. 비우면 접속 계정 — 그 계정이 가진 테이블을 본다
owner="${db_owner:-$(printf '%s' "$db_user" | tr '[:lower:]' '[:upper:]')}"
# SQL 에 그대로 들어가므로 식별자 글자만 받는다
[[ "$owner" =~ ^[A-Z0-9_\$#]+$ ]] || die "${prefix}_DB_OWNER(비었으면 DB_USER)에 쓸 수 없는 글자가 있습니다: $owner"

# 기본값을 ${FILE_NAME:-…} 안에 바로 쓰면 그 안의 } 가 확장을 일찍 닫는다 — 변수로 따로 둔다
default_file_name='snapshot_{env}_{date}.txt'
file_pattern="${FILE_NAME:-$default_file_name}"
file_name="${file_pattern//\{env\}/$env_id}"
file_name="${file_name//\{date\}/$snap_date}"

# ── sqlplus 찾기 ───────────────────────────────────────────────────────
# 설정의 SQLPLUS → shl/oracle 에 푼 Instant Client → PATH 순서
find_sqlplus() {
  if [ -n "${SQLPLUS:-}" ]; then
    printf '%s' "$SQLPLUS"
    return
  fi
  local bundled
  bundled="$(ls -d "$SHL_DIR"/oracle/instantclient_*/sqlplus.exe 2>/dev/null | sort -V | tail -1)"
  if [ -n "$bundled" ]; then
    printf '%s' "$bundled"
    return
  fi
  command -v sqlplus || true
}

sqlplus_bin="$(find_sqlplus)"
[ -n "$sqlplus_bin" ] || die "sqlplus 가 없습니다 — shl/install-oracle-client.sh 를 먼저 실행하세요."

# ── 조회 SQL ───────────────────────────────────────────────────────────
# SELECT 는 change/check_table.sql 에 둔다 (팀이 함께 쓰고 커밋한다). 여기서는 앞뒤 틀만 붙인다.
# 출력 형식을 정하는 SET 은 화면이 읽을 수 있느냐가 걸려 있어 SQL 파일에 맡기지 않는다.
[ -f "$SQL_FILE" ] || die "조회 SQL 이 없습니다: $SQL_FILE"

# 메모장이 붙이는 BOM 과 CRLF 를 걷어낸다 — BOM 이 남으면 첫 줄이 SP2-0734 로 깨진다
query="$(sed '1s/^\xEF\xBB\xBF//' "$SQL_FILE" | tr -d '\r')"

# 정의 안 된 치환 변수가 있으면 sqlplus 가 값을 물으며 표준입력의 다음 줄(SQL)을 값으로 삼킨다.
# 조용히 엉뚱한 결과가 나오므로 DB 에 묻기 전에 막는다.
unknown_vars="$(printf '%s\n' "$query" | grep -oE '&&?[A-Za-z_][A-Za-z0-9_$#]*' | grep -viE '^&&?owner$' | sort -u | tr '\n' ' ' || true)"
[ -z "$unknown_vars" ] || die "$SQL_FILE 에 모르는 치환 변수가 있습니다: ${unknown_vars}— 쓸 수 있는 것은 &owner 하나입니다."

# 접속보다 먼저 WHENEVER 를 걸어야 접속 실패(ORA-01017 등)에서도 0 이 아닌 코드로 끝난다.
# SQLBLANKLINES ON: sqlplus 는 기본으로 빈 줄에서 문장을 끊는다. DB 툴에서 붙여 넣은 쿼리는 중간에 빈 줄이
# 흔한데, 그러면 SELECT 는 실행되지 않고 뒷줄(ORDER BY 등)이 SP2-0734 "rest of line ignored" 로 깨진다.
# 켜 두면 Toad · SQL Developer 처럼 ; 까지를 한 문장으로 읽는다.
sql_head() {
  cat <<SQL
SET PAGESIZE 0
SET LINESIZE 32767
SET TRIMOUT ON
SET FEEDBACK OFF
SET HEADING OFF
SET VERIFY OFF
SET ECHO OFF
SET TAB OFF
SET DEFINE ON
SET SQLBLANKLINES ON
DEFINE owner = $owner
WHENEVER SQLERROR EXIT FAILURE
WHENEVER OSERROR EXIT FAILURE
SQL
}

# ── 조회 ───────────────────────────────────────────────────────────────
read -rsp "DB 비밀번호 (${db_user}@${db_connect}): " db_password
echo >&2
# CONNECT 의 "…" 안에 그대로 들어가므로 큰따옴표만은 받을 수 없다
[[ "$db_password" != *\"* ]] || die "비밀번호에 큰따옴표(\")가 있으면 이 스크립트로 접속할 수 없습니다."

# 결과는 영문 · UTF-8 로 받는다 — 오류 문구(ORA-)를 아래에서 글자로 가려낸다
export NLS_LANG="AMERICAN_AMERICA.AL32UTF8"
# MSYS_NO_PATHCONV: Git Bash 는 윈도우 프로그램에 넘기는 `/nolog` 를 `C:/Program Files/Git/nolog`
# 로 바꿔 버린다. 그러면 sqlplus 가 사용법만 찍고 끝나므로 이 호출에서만 변환을 끈다.

echo "조회 중: $owner @ $db_connect" >&2
set +e
raw="$(
  {
    sql_head
    printf 'CONNECT %s/"%s"@%s\n' "$db_user" "$db_password" "$db_connect"
    printf '%s\n\nEXIT\n' "$query"
  } | MSYS_NO_PATHCONV=1 "$sqlplus_bin" -s -L /nolog
)"
status=$?
set -e
unset db_password
raw="${raw//$'\r'/}"

# 종료 코드만 믿지 않고 글자로도 본다 — SP2- 계열(SQL*Plus 자체 오류)은 WHENEVER SQLERROR 에
# 걸리지 않아 오류가 나도 0 으로 끝날 수 있다
errors="$(printf '%s\n' "$raw" | grep -E '^(ORA-|SP2-|ERROR)' || true)"
if [ "$status" -ne 0 ] || [ -n "$errors" ]; then
  printf '%s\n' "${errors:-$raw}" | head -20 >&2
  die "DB 조회에 실패했습니다 (sqlplus 종료 코드 $status). 서버에는 아무것도 올리지 않았습니다."
fi

# awk 로 센다 — grep 은 0건이면 1 로 끝나 pipefail 이 안내 없이 스크립트를 끝내 버린다
table_count="$(printf '%s\n' "$raw" | awk -F, '$1 == "[COLUMN]" && $2 != "TABLE_NAME" { print $2 }' | sort -u | wc -l | tr -d ' ')"
if [ "$table_count" -eq 0 ]; then
  die "조회된 테이블이 없습니다 — ${prefix}_DB_USER · ${prefix}_DB_OWNER 와 change/check_table.sql 을 확인하세요. 서버에는 아무것도 올리지 않았습니다."
fi

mkdir -p "$OUT_DIR"
out_file="$OUT_DIR/$file_name"
{
  printf '# %s 스키마 덤프 — %s · %s (shl/schema-dump.sh)\n\n' "$env_id" "$snap_date" "$owner"
  printf '%s\n' "$raw"
} > "$out_file"
echo "만듦: $out_file (테이블 ${table_count}개)" >&2

# ── 업로드 ─────────────────────────────────────────────────────────────
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

dir_q="$(quote_remote_dir "$remote_dir")"
name_q="$(shell_quote "$file_name")"
tmp_q="$(shell_quote ".$file_name.tmp")"

# 임시 이름으로 다 받은 뒤 이름을 바꾼다 — 중간에 끊겨도 화면이 반쪽 파일을 읽지 않는다
remote_cmd="mkdir -p $dir_q && cd $dir_q"
if [ "$force" -eq 0 ]; then
  remote_cmd+=" && { [ ! -e $name_q ] || exit $EXIT_EXISTS; }"
fi
remote_cmd+=" && { cat > $tmp_q && mv -f $tmp_q $name_q || { rm -f $tmp_q; exit 1; }; }"

ssh_args=(-o ConnectTimeout=10 -o StrictHostKeyChecking=yes)
if [ -n "${SSH_PORT:-}" ]; then ssh_args+=(-p "$SSH_PORT"); fi
if [ -n "${SSH_IDENTITY:-}" ]; then ssh_args+=(-i "$SSH_IDENTITY"); fi
target="${SSH_USER:+$SSH_USER@}$SSH_HOST"

echo "올리는 중: $target:$remote_dir/$file_name" >&2
set +e
ssh "${ssh_args[@]}" "$target" "$remote_cmd" < "$out_file"
status=$?
set -e

if [ "$status" -eq "$EXIT_EXISTS" ]; then
  die "서버에 $file_name 이 이미 있습니다. 덮어쓰려면 --force 를 붙이세요."
fi
if [ "$status" -ne 0 ]; then
  echo "만든 파일은 그대로 있습니다. 손으로 올리려면:" >&2
  echo "  scp \"$out_file\" $target:$remote_dir/" >&2
  die "업로드에 실패했습니다 (ssh 종료 코드 $status)."
fi

echo "완료: $target:$remote_dir/$file_name" >&2
