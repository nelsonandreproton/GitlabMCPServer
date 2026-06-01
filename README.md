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
data: {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"better-gitlab-mcp-server","version":"2.1.18"}},"jsonrpc":"2.0","id":1}
```

## Environment variables

### Gateway (`server.js`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8808` | Gateway listening port |
| `UPSTREAM_PORT` | `3002` | Upstream port |
| `UPSTREAM_HOST` | `127.0.0.1` | Upstream host |
| `STATS_FILE` | `./usage-stats.json` | Path for anonymous usage stats (put on a persistent volume in prod) |

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

## Anonymous usage tracking

The gateway counts **distinct users per day** without storing who. Each request's
token is hashed (SHA-256, one-way — the raw token is never written to disk) and
deduplicated per UTC day.

Read the counts (no token required):

```bash
curl https://your-host/stats
# {"2026-06-01": 5, "2026-06-02": 8}
```

Only counts are exposed — never the underlying hashes. State persists to
`STATS_FILE`, which should live on a persistent volume so it survives redeploys.
Run the tests with `node --test` (pure stdlib, no dependencies).

## Production deployment

Deployed via Docker on the Hetzner homeserver (`@zereight/mcp-gitlab` upstream +
gateway as two compose services), behind Caddy with an automatic Let's Encrypt
cert on an `sslip.io` hostname. See `Dockerfile`, `Dockerfile.upstream`, and the
project memory for the exact homeserver wiring.

Key points:
- Bake `@zereight/mcp-gitlab` into the upstream image (pinned version) — do not
  `npx -y` at runtime.
- Gateway needs `UPSTREAM_HOST=<upstream-service-name>` to reach the sibling
  container; the default `127.0.0.1` only works when both run on the same host.
- Mount a named volume for `STATS_FILE`, owned by the `node` user (uid 1000).
- Caddy: `reverse_proxy gateway:8808` on a dedicated `sslip.io` subdomain — Caddy
  issues the TLS cert automatically.
- Drop `NODE_TLS_REJECT_UNAUTHORIZED=0` if your GitLab cert is publicly trusted.

## Files

| File | Description |
|---|---|
| `server.js` | Gateway proxy |
| `usage.js` | Anonymous daily usage tracking |
| `usage.test.js` | Tests for usage tracking (`node --test`) |
| `Dockerfile` | Gateway image |
| `Dockerfile.upstream` | `@zereight/mcp-gitlab` upstream image (pinned) |
| `start.bat` | Windows launcher (starts both processes) |
| `test-body.json` | MCP initialize payload for curl testing |
| `CLAUDE.md` | Claude Code context (for AI-assisted development) |
