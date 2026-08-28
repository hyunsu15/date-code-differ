#!/bin/sh
# SSH_ASKPASS 는 인자를 못 넘기므로 셸 스크립트로 감싼다 (POSIX 용)
# 묻는 문구(ssh 가 넘기는 인자)는 일부러 전달하지 않는다 — askpass.mjs 주석 참고
exec node "$(dirname "$0")/askpass.mjs"
