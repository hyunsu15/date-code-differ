#!/usr/bin/env bash
# Oracle Instant Client(sqlplus) 를 shl/oracle/ 아래에 내려받아 푼다 — 윈도우 x64 · Git Bash 용.
#
# 사용:  shl/install-oracle-client.sh
#
# 설치가 아니라 **압축 해제**다. 관리자 권한 · 레지스트리 · PATH 를 건드리지 않고,
# schema-dump.sh 가 이 폴더의 sqlplus.exe 를 알아서 찾는다. 지우려면 shl/oracle/ 만 지우면 된다.
#
# 19 버전을 쓰는 이유: 19 는 DB 11.2 · 12c · 18c · 19c · 21c 에 붙는다.
# 23 은 DB 19c 이상만 받아서, 오래된 운영 DB 에서는 접속 자체가 안 된다.
#
# 받은 파일은 Oracle 이 다운로드 페이지에 적어 둔 SHA256 과 맞춰 본다 — 다르면 풀지 않는다.
# 실행에는 Visual C++ 재배포 패키지(2015~2022 공용)가 필요하다. 대부분의 PC 에 이미 있다.
set -euo pipefail

SHL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORACLE_DIR="$SHL_DIR/oracle"
BASE_URL="https://download.oracle.com/otn_software/nt/instantclient/1932000"

# 파일명 · SHA256 (https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html)
PACKAGES=(
  "instantclient-basic-windows.x64-19.32.0.0.0dbru.zip e95a66eb4e69e2fb28880cbd252e8eab9807b877c4248c0d50a28f7b75cfe878"
  "instantclient-sqlplus-windows.x64-19.32.0.0.0dbru.zip 5ec590c65ceaff3fe5bc81eef8ce7a624c6e03d6ab94c7daa9554fd384550c4a"
)

die() { echo "오류: $*" >&2; exit 1; }

# 회사망 프록시가 인증서 폐기 목록을 막으면 윈도우 curl(schannel)이 CRYPT_E_NO_REVOCATION_CHECK 로
# 실패한다. --ssl-no-revoke 는 폐기 확인만 건너뛸 뿐 인증서 검증은 그대로 하고, 받은 파일은
# 아래에서 SHA256 으로 한 번 더 확인한다.
download() {
  curl -fSL --ssl-no-revoke -o "$2" "$1" 2>/dev/null || curl -fSL -o "$2" "$1"
}

install_package() {
  local file="$1" sha="$2"
  local zip="$ORACLE_DIR/$file"

  echo "받는 중: $file"
  download "$BASE_URL/$file" "$zip" || die "$file 을 받지 못했습니다 — 회사망에서 download.oracle.com 이 막혀 있는지 확인하세요."

  local actual
  actual="$(sha256sum "$zip" | cut -d' ' -f1)"
  if [ "$actual" != "$sha" ]; then
    rm -f "$zip"
    die "$file 의 SHA256 이 다릅니다 (받은 값 $actual) — 지우고 멈춥니다."
  fi

  unzip -oq "$zip" -d "$ORACLE_DIR"
  rm -f "$zip"
}

mkdir -p "$ORACLE_DIR"
for entry in "${PACKAGES[@]}"; do
  install_package $entry
done

sqlplus="$(ls -d "$ORACLE_DIR"/instantclient_*/sqlplus.exe | sort -V | tail -1)"
"$sqlplus" -v || die "sqlplus 가 실행되지 않습니다 — Visual C++ 재배포 패키지(2015~2022)를 설치한 뒤 다시 실행하세요."
echo "완료: $sqlplus"
