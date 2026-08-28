#!/bin/sh
# SSH_ASKPASS 는 인자를 못 넘기므로 셸 스크립트로 감싼다 (POSIX 용)
exec node "$(dirname "$0")/askpass.mjs"
