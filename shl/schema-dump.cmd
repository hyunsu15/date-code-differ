@echo off
rem Git Bash 를 열지 않고 PowerShell · cmd 에서 schema-dump.sh 를 부른다. 인자 · 종료 코드는 그대로다.
rem   shl\schema-dump.cmd prod
rem   shl\schema-dump.cmd test 2026-10-20 --force
rem .ps1 이 아닌 이유: 윈도우 기본 실행 정책(Restricted)에서 .ps1 은 막히지만 .cmd 는 막히지 않는다.
setlocal
set "SH_SCRIPT=%~dp0schema-dump.sh"
call "%~dp0_git-bash.cmd" %*
exit /b %ERRORLEVEL%
