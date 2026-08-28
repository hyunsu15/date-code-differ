/**
 * ssh 가 비밀번호를 물어볼 때 대신 답해 주는 프로그램 (SSH_ASKPASS).
 *
 * OpenSSH 는 비밀번호를 stdin 이 아니라 제어 터미널에서 읽으므로 파이프로 넣을 수 없다.
 * 대신 `SSH_ASKPASS` 로 지정한 프로그램의 표준출력을 읽는 공식 경로가 있어 그걸 쓴다.
 * (`SSH_ASKPASS_REQUIRE=force` 를 함께 줘야 터미널이 있어도 이쪽을 쓴다)
 *
 * 비밀번호는 **환경변수로만** 받는다. 명령줄 인자로 넘기면 `ps` 로 다른 사용자에게 보인다.
 * 외부 라이브러리를 쓰지 않는다 — OpenSSH 자체 기능이다.
 *
 * ------------------------------------------------------------------
 * **묻는 문구는 보지 않는다.**
 *
 * ssh 는 물어볼 문구를 첫 인자로 넘겨주지만, 그 문구에는 원격 서버가 보낸 글자가
 * 섞일 수 있다(keyboard-interactive). Windows 에서는 `.cmd` 래퍼를 거치는데
 * cmd.exe 가 인자를 다시 해석하므로, 넘겨받는 것 자체가 명령 주입 통로가 된다.
 * 그래서 인자를 아예 받지 않는다.
 *
 * 대신 **비밀번호가 아닌 질문은 ssh 단계에서 없앤다** — `StrictHostKeyChecking=yes`
 * 라서 호스트 키 확인("continue connecting (yes/no)?")을 애초에 묻지 않는다
 * (sshCommands.ts 의 `sshOptions` 참고). 그게 없으면 이 프로그램이 비밀번호를
 * yes/no 질문의 답으로 흘려보내게 된다.
 */

const password = process.env.CODE_DIFF_SSH_PASSWORD

// 보관 중인 비밀번호가 없으면 빈 답 대신 실패로 끝낸다.
// 빈 문자열을 내보내면 ssh 가 "빈 비밀번호" 로 인증을 시도한다.
if (!password) process.exit(1)

process.stdout.write(password)
