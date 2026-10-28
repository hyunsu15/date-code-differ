@echo off
rem Git Bash 를 열지 않고 PowerShell · cmd 에서 deploy-rollback.sh 를 부른다. 종료 코드는 그대로다.
rem   shl\deploy-rollback.cmd
setlocal
set "SH_SCRIPT=%~dp0deploy-rollback.sh"
call "%~dp0_git-bash.cmd" %*
exit /b %ERRORLEVEL%
