/**
 * ssh 가 비밀번호를 물어볼 때 대신 답해 주는 프로그램 (SSH_ASKPASS).
 *
 * OpenSSH 는 비밀번호를 stdin 이 아니라 제어 터미널에서 읽으므로 파이프로 넣을 수 없다.
 * 대신 `SSH_ASKPASS` 로 지정한 프로그램의 표준출력을 읽는 공식 경로가 있어 그걸 쓴다.
 * (`SSH_ASKPASS_REQUIRE=force` 를 함께 줘야 터미널이 있어도 이쪽을 쓴다)
 *
 * 비밀번호는 **환경변수로만** 받는다. 명령줄 인자로 넘기면 `ps` 로 다른 사용자에게 보인다.
 * 외부 라이브러리를 쓰지 않는다 — OpenSSH 자체 기능이다.
 */
process.stdout.write(process.env.CODE_DIFF_SSH_PASSWORD ?? '')
