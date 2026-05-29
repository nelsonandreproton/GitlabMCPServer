# mcp-gitlab-gateway

A thin Node.js HTTP proxy that exposes [`@zereight/mcp-gitlab`](https://www.npmjs.com/package/@zereight/mcp-gitlab) over HTTP with per-user GitLab token injection via query string.

Designed for **Notion MCP integration**, which only accepts a URL — no custom headers. Each user connects with their own GitLab Personal Access Token embedded in the URL.

```
https://your-host/mcp?token=GITLAB_PERSONAL_ACCESS_TOKEN
```

## How it works

```
Notion / Claude
    │  POST /mcp?token=USER_PAT
    ▼
server.js  (gateway, port 8808)
    │  POST /mcp  +  Authorization: Bearer USER_PAT
    ▼
@zereight/mcp-gitlab  (upstream, port 3002)
    │  per-request token injection via remote-auth
    ▼
GitLab API
```

Two processes run side by side:

- **Upstream** — `@zereight/mcp-gitlab` in `streamable-http` + `remote-auth` mode. Handles all MCP protocol logic and GitLab API calls. Listens on `127.0.0.1:3002`.
- **Gateway** — `server.js`, a ~70-line Node.js proxy. Reads `?token=` from the URL and forwards it as `Authorization: Bearer` to the upstream. Listens on `0.0.0.0:8808`.

## Quick start (Windows)

```powershell
cd C:\dev\GitlabMCPServer
.\start.bat
```

Edit `start.bat` first to set `GITLAB_API_URL` to your GitLab instance.

## Quick start (Linux)

```bash
# Terminal 1 — upstream
GITLAB_API_URL=https://your-gitlab/api/v4 \
GITLAB_PERSONAL_ACCESS_TOKEN=placeholder \
STREAMABLE_HTTP=true \
REMOTE_AUTHORIZATION=true \
HOST=127.0.0.1 \
PORT=3002 \
npx -y @zereight/mcp-gitlab

# Terminal 2 — gateway
PORT=8808 UPSTREAM_PORT=3002 node server.js
```

> **Note:** Configure `@zereight/mcp-gitlab` via environment variables only. Boolean CLI flags (`--streamable-http`) are silently ignored due to a parser bug in the package.

## Test

```bash
# Health check
curl http://localhost:8808/health

# MCP handshake
curl -s -X POST "http://localhost:8808/mcp?token=YOUR_GITLAB_PAT" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

Expected response:
```
event: message
data: {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"better-gitlab-mcp-server","version":"2.1.16"}},"jsonrpc":"2.0","id":1}
```

## Environment variables

### Gateway (`server.js`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8808` | Gateway listening port |
| `UPSTREAM_PORT` | `3002` | Upstream port |
| `UPSTREAM_HOST` | `127.0.0.1` | Upstream host |

### Upstream (`@zereight/mcp-gitlab`)

| Variable | Required | Description |
|---|---|---|
| `GITLAB_API_URL` | Yes | GitLab API base URL, e.g. `https://gitlab.com/api/v4` |
| `GITLAB_PERSONAL_ACCESS_TOKEN` | Yes | Any non-empty value — overridden per-request |
| `STREAMABLE_HTTP` | Yes | Must be `true` |
| `REMOTE_AUTHORIZATION` | Yes | Must be `true` |
| `HOST` | No | Bind address (default `127.0.0.1`) |
| `PORT` | No | Port (default `3002`) |
| `NODE_TLS_REJECT_UNAUTHORIZED` | No | Set to `0` for self-signed certs |

## Connecting from Notion

In Notion → **Settings → Connections → Add MCP server**, enter:

```
https://your-host/mcp?token=YOUR_GITLAB_PAT
```

The token needs at minimum `read_api` scope. Use `api` scope for write operations (creating issues, MRs, etc.).

## Production deployment

See [`deploy.html`](deploy.html) for the full step-by-step guide to deploying on Linux with systemd + nginx + TLS.

Summary:
1. Install Node.js 18+
2. Clone this repo to `/opt/mcp-gitlab-gateway`
3. `npm install @zereight/mcp-gitlab`
4. Create `/opt/mcp-gitlab-gateway/.env` with the env vars above
5. Install both systemd services (see `deploy.html`)
6. Configure nginx with `proxy_buffering off` and `proxy_read_timeout 86400s`
7. Open port 443 in your Azure NSG

## Files

| File | Description |
|---|---|
| `server.js` | Gateway proxy (~70 lines) |
| `start.bat` | Windows launcher (starts both processes) |
| `test-body.json` | MCP initialize payload for curl testing |
| `deploy.html` | Full Linux/Azure deployment guide |
| `CLAUDE.md` | Claude Code context (for AI-assisted development) |
