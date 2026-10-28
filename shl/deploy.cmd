@echo off
rem Git Bash 를 열지 않고 PowerShell · cmd 에서 deploy.sh 를 부른다. 인자 · 종료 코드는 그대로다.
rem   shl\deploy.cmd
rem   shl\deploy.cmd --skip-build
rem   shl\deploy.cmd --no-run
setlocal
set "SH_SCRIPT=%~dp0deploy.sh"
call "%~dp0_git-bash.cmd" %*
exit /b %ERRORLEVEL%
