@echo off
setlocal
pushd "%~dp0" || exit /b 1
call npm ci --no-audit --no-fund
if errorlevel 1 (
    popd
    exit /b 1
)
node bin\agentcorp.js setup --web %*
set "result=%errorlevel%"
popd
exit /b %result%
