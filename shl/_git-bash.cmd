@echo off
rem shl\*.cmd 공용 — Git for Windows 의 bash 로 SH_SCRIPT(.sh)를 실행하고 인자를 그대로 넘긴다.
rem 직접 부르지 않는다. schema-dump.cmd 처럼 SH_SCRIPT 를 정한 뒤 call 한다.
rem
rem PATH 의 bash 는 쓰지 않는다 — C:\Windows\System32\bash.exe 는 WSL 이라 윈도우 경로 · sqlplus.exe 를 못 쓴다.
setlocal
set "GIT_BASH="
for %%P in ("%ProgramFiles%\Git\bin\bash.exe" "%LocalAppData%\Programs\Git\bin\bash.exe") do (
  if not defined GIT_BASH if exist "%%~P" set "GIT_BASH=%%~P"
)
rem 다른 곳에 설치했으면 git.exe 위치(...\Git\cmd\git.exe)에서 찾는다
if not defined GIT_BASH for /f "delims=" %%G in ('where git.exe 2^>nul') do (
  if not defined GIT_BASH if exist "%%~dpG..\bin\bash.exe" set "GIT_BASH=%%~dpG..\bin\bash.exe"
)
if not defined GIT_BASH goto no_bash

rem bash 의 dirname 은 / 만 경로 구분자로 본다 — \ 그대로 넘기면 스크립트가 자기 폴더를 못 찾는다
set "SH_SCRIPT=%SH_SCRIPT:\=/%"
"%GIT_BASH%" "%SH_SCRIPT%" %*
exit /b %ERRORLEVEL%

:no_bash
rem 한국어 윈도우 콘솔(949)에서 UTF-8 안내가 깨지지 않게 잠깐 바꿨다가 되돌린다
for /f "tokens=2 delims=:." %%C in ('chcp') do set "PREV_CP=%%C"
chcp 65001 >nul
echo 오류: Git for Windows 의 bash.exe 를 찾지 못했습니다. https://git-scm.com 에서 Git 을 설치하세요. 1>&2
chcp %PREV_CP% >nul
exit /b 1
