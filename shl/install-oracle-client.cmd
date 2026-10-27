@echo off
rem Git Bash 를 열지 않고 PowerShell · cmd 에서 install-oracle-client.sh 를 부른다.
rem   shl\install-oracle-client.cmd
setlocal
set "SH_SCRIPT=%~dp0install-oracle-client.sh"
call "%~dp0_git-bash.cmd" %*
exit /b %ERRORLEVEL%
