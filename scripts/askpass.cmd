@echo off
rem SSH_ASKPASS 는 인자를 못 넘기므로 .cmd 로 감싼다 (Windows OpenSSH 용)
node "%~dp0askpass.mjs"
