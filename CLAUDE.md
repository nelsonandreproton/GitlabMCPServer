# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A two-process HTTP gateway that exposes GitLab MCP tools over HTTP for Notion integration.

- **Upstream** (`@zereight/mcp-gitlab`): runs in `streamable-http` + `remote-auth` mode on port 3002. Handles all MCP protocol logic and GitLab API calls. Per-request token injection via `Authorization: Bearer <token>` header.
- **Gateway** (`server.js`): thin Node.js HTTP proxy on port 8808. Reads `?token=X` from the URL (the only option Notion MCP allows) and forwards it as `Authorization: Bearer X` to the upstream.

Notion client URL: `http://host:8808/mcp?token=USER_GITLAB_PAT`

## Running locally (Windows)

```powershell
.\start.bat
```

This starts the upstream in a background `cmd` window, waits 5 seconds, then runs the gateway in the foreground.

Or manually:

```powershell
# Terminal 1 — upstream
$env:GITLAB_API_URL = "https://np-gitlab.swedencentral.cloudapp.azure.com/api/v4"
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
$env:GITLAB_PERSONAL_ACCESS_TOKEN = "placeholder"   # bypasses startup check; overridden per-request
$env:STREAMABLE_HTTP = "true"
$env:REMOTE_AUTHORIZATION = "true"
$env:HOST = "127.0.0.1"
$env:PORT = "3002"
npx -y @zereight/mcp-gitlab

# Terminal 2 — gateway
$env:PORT = "8808"
$env:UPSTREAM_PORT = "3002"
node server.js
```

**Important:** `@zereight/mcp-gitlab` reads flags only via env vars (not `--flag` CLI args), because boolean flags like `--streamable-http` are parsed as `=` assignments and fail the `=== "true"` check in `config.js`.

## Testing

```powershell
# Health check
curl.exe http://localhost:8808/health

# MCP initialize handshake — must include both Accept values for streamable HTTP
curl.exe -s -X POST "http://localhost:8808/mcp?token=YOUR_GITLAB_PAT" `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -d "@test-body.json"
```

Expected response:
```json
event: message
data: {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"better-gitlab-mcp-server","version":"2.1.16"}},"jsonrpc":"2.0","id":1}
```

## Environment variables

### Gateway (`server.js`)
| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8808` | Gateway listening port |
| `UPSTREAM_PORT` | `3002` | Upstream port |
| `UPSTREAM_HOST` | `127.0.0.1` | Upstream host |

### Upstream (`@zereight/mcp-gitlab`)
| Variable | Required | Notes |
|---|---|---|
| `GITLAB_API_URL` | Yes | GitLab instance API base URL |
| `GITLAB_PERSONAL_ACCESS_TOKEN` | Yes | Any non-empty string — overridden per-request by `REMOTE_AUTHORIZATION` |
| `STREAMABLE_HTTP` | Yes | Must be `"true"` |
| `REMOTE_AUTHORIZATION` | Yes | Must be `"true"` — enables per-request token from `Authorization` header |
| `HOST` | No | Bind address, defaults to `127.0.0.1` |
| `PORT` | No | Upstream port, defaults to `3002` |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | Set to `"0"` for self-signed certs |

## Architecture

```
Notion client
    │  POST /mcp?token=USER_PAT
    ▼
server.js (port 8808)
    │  POST /mcp
    │  Authorization: Bearer USER_PAT
    ▼
@zereight/mcp-gitlab (port 3002)
    │  reads token from Authorization header per-request
    ▼
GitLab API (GITLAB_API_URL)
```

## Production deployment (Linux / Azure VM)

- Run both processes as systemd services with `EnvironmentFile`
- nginx reverse proxy on 443 → gateway on 8808; `proxy_buffering off`, `proxy_read_timeout 86400s`
- TLS via certbot
- Remove `NODE_TLS_REJECT_UNAUTHORIZED=0` once TLS cert is trusted (or add `GITLAB_CA_CERT_PATH` instead)
- Add authentication: nginx basic auth or Azure NSG IP restrictions

## Expose for Notion testing via ngrok

```powershell
ngrok http 8808
# Notion custom server URL: https://xxxx.ngrok-free.app/mcp?token=YOUR_PAT
```
