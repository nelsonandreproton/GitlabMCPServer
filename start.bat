@echo off
REM ---------------------------------------------------------------------------
REM  mcp-gitlab-gateway — start both processes
REM
REM  Process 1 (upstream): @zereight/mcp-gitlab in streamable-http + remote-auth
REM  Process 2 (gateway):  thin HTTP proxy that injects ?token= as Authorization
REM ---------------------------------------------------------------------------

set GITLAB_API_URL=https://np-gitlab.swedencentral.cloudapp.azure.com/api/v4
set NODE_TLS_REJECT_UNAUTHORIZED=0

REM Upstream: token is supplied per-request via Authorization header (remote-auth).
REM GITLAB_PERSONAL_ACCESS_TOKEN must be non-empty to pass startup validation;
REM it is overridden per-request by REMOTE_AUTHORIZATION=true.
set GITLAB_PERSONAL_ACCESS_TOKEN=placeholder
set STREAMABLE_HTTP=true
set REMOTE_AUTHORIZATION=true
set HOST=127.0.0.1
set PORT=3002

echo Starting upstream (@zereight/mcp-gitlab) on port 3002...
start /b cmd /c "npx -y @zereight/mcp-gitlab >> upstream.log 2>&1"

REM Give the upstream a few seconds to start before the gateway tries to connect
timeout /t 5 /nobreak >nul

REM Gateway: receives ?token=X and proxies with Authorization: Bearer X
set PORT=8808
set UPSTREAM_PORT=3002

echo Starting gateway on port 8808...
node server.js
