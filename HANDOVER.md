# mcp-gitlab-gateway — Claude Code Handover

## What this is

A thin Node.js HTTP/SSE server that wraps `@zereight/mcp-gitlab` (a stdio-based MCP server)
and exposes it over HTTP/SSE with per-user GitLab token injection via query string:

```
http://localhost:8808/mcp?token=GITLAB_PERSONAL_ACCESS_TOKEN
```

Each incoming connection spawns a dedicated `@zereight/mcp-gitlab` child process with the
token injected as `GITLAB_PERSONAL_ACCESS_TOKEN`. The child process exits when the client
disconnects.

**End goal:** Deploy this on a Linux VM (same Azure VNet as GitLab) so Notion MCP integration
can connect each user with their own GitLab PAT via:
```
https://mcp-gitlab.yourdomain.com/mcp?token=USER_TOKEN
```

---

## Environment

- **Dev machine:** Windows 11, Node.js v24.14.1
- **Target GitLab:** `https://np-gitlab.swedencentral.cloudapp.azure.com/api/v4`
  - Self-signed certificate → requires `NODE_TLS_REJECT_UNAUTHORIZED=0`
  - Private Azure hostname — only reachable from within the Azure VNet
- **MCP package:** `@zereight/mcp-gitlab` (community package, stdio transport)
- **Target consumer:** Notion MCP custom server integration (SSE over HTTPS)

---

## Current state of the code

### Files

- `server.js` — main gateway server (see below)
- `start.bat` — Windows launcher, sets `GITLAB_API_URL` and runs `node server.js`
- `test-body.json` — MCP initialize handshake payload for curl testing

### What server.js does

1. Listens on `PORT` (default 8808)
2. On `GET /health` → returns `{ status: "ok", sessions: N }`
3. On `GET /mcp?token=X` or `POST /mcp?token=X`:
   - Writes SSE headers
   - Spawns `npx -y @zereight/mcp-gitlab` with `shell: true` (required on Windows)
   - Injects token + GitLab API URL + TLS flag into child env
   - Bridges child stdout → SSE `data:` events
   - Bridges POST body → child stdin
   - Kills child on client disconnect
   - Sends `: keepalive` every 30s

### Known issue — NOT YET FIXED

**The server does not work end-to-end yet.**

The curl test closes the connection before receiving any data:

```
curl.exe -N -X POST "http://localhost:8808/mcp?token=TOKEN" \
  -H "Content-Type: application/json" -d "@test-body.json"
# Returns empty, connection closes immediately
```

Server log shows:
```
[session N] New connection from ::1
[session N] Spawned child PID 23816
[session N] Client disconnected, killing child PID 23816
[session N] Child exited code=null signal=SIGTERM
```

The child spawns successfully (PID is defined, stderr shows MCP init messages) but the
client disconnects before the child's stdout response arrives.

**Root cause hypothesis:** The child process takes ~2 seconds to start and produce its first
stdout line. curl closes the connection before that. A fix was discussed — sending an
immediate SSE comment (`res.write(": connected\n\n")`) before spawning the child — but
**has not been applied to the file yet**.

---

## What needs to be done

### 1. Fix the connection timing issue (immediate)

Add `res.write(": connected\n\n")` immediately after writing SSE headers, before spawning
the child. This keeps the client connection alive while the child starts up.

Location in server.js — find this comment and add the line above it:
```js
// Spawn the MCP child process with the per-request token
```

Should become:
```js
res.write(": connected\n\n");

// Spawn the MCP child process with the per-request token
```

### 2. Verify end-to-end with curl

After the fix, test with:
```bash
curl -N -X POST "http://localhost:8808/mcp?token=TOKEN" \
  -H "Content-Type: application/json" -d "@test-body.json"
```

Expected output — a `data:` line with the MCP initialize response:
```
: connected

data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{...}}}
```

### 3. Verify MCP message routing works

The current architecture has a potential design flaw worth validating:

Notion's MCP-over-SSE protocol may use **two separate HTTP connections**:
- A persistent `GET` to establish the SSE stream
- Separate `POST` requests to send MCP messages

If that's the case, the current server (which ties stdin/stdout to a single connection) won't
work — the POST opens a new session with a new child process that has no relation to the
GET's child process.

**Test this by:**
1. Opening a persistent GET SSE connection in one terminal
2. Sending the POST in a second terminal to the same URL
3. Checking whether the response appears on the GET stream or the POST response

If responses don't appear on the GET stream, the server needs session correlation:
- Generate a `sessionId` on GET /mcp
- Return it as the first SSE event
- Accept `POST /mcp?token=X&sessionId=Y` and route stdin to the matching child process

### 4. Linux production hardening (after local test passes)

For deployment on the Azure VM:
- Remove `shell: true` from spawn (not needed on Linux, cleaner)
- Add `NODE_TLS_REJECT_UNAUTHORIZED=0` only via systemd EnvironmentFile, not hardcoded
- Set up nginx reverse proxy with `proxy_buffering off` and `proxy_read_timeout 86400s`
- TLS via certbot
- Run as non-root systemd service

---

## Lessons learned

### Windows-specific

- `spawn("npx", ...)` fails with `ENOENT` on Windows unless `shell: true` is passed.
  Node cannot find `npx` without going through `cmd.exe`.
- PowerShell's `curl` is an alias for `Invoke-WebRequest` — always use `curl.exe` explicitly
  for SSE testing.
- PowerShell mangles JSON escaping in `-d` arguments. Use `-d "@filename.json"` with a file
  instead.
- `Invoke-WebRequest` closes the connection as soon as headers are received — useless for SSE
  testing. Use `curl.exe` only.

### MCP/SSE protocol

- `@zereight/mcp-gitlab` takes ~2 seconds to produce its first stdout line. Any HTTP client
  with a short timeout will disconnect before seeing data.
- SSE requires nginx config: `proxy_buffering off`, `proxy_cache off`,
  `proxy_read_timeout 86400s`. Missing any of these causes silent stream failures.
- The `X-Accel-Buffering: no` response header tells nginx not to buffer even if misconfigured.

### Architecture decisions made

- **Per-user tokens via query string** — chosen because Notion's MCP UI only accepts a URL,
  no header or auth fields. Trade-off: tokens appear in server access logs.
- **One child process per connection** — simplest model, avoids shared state. Trade-off:
  ~2s startup latency per new Notion session.
- **supergateway rejected** — evaluated but discarded because it spawns one static child
  process with fixed env vars, making per-user token injection impossible.
- **No authentication layer yet** — for local testing only. Production needs nginx basic auth
  or Azure NSG IP restrictions at minimum.

---

## How to run locally (Windows)

```powershell
# Edit start.bat to set GITLAB_API_URL, then:
.\start.bat

# Test health
curl.exe http://localhost:8808/health

# Test MCP handshake (after fix is applied)
curl.exe -N -X POST "http://localhost:8808/mcp?token=YOUR_TOKEN" `
  -H "Content-Type: application/json" -d "@test-body.json"
```

## How to expose for Notion testing

```powershell
ngrok http 8808
# Notion URL: https://xxxx.ngrok-free.app/mcp?token=YOUR_TOKEN
```

---

## References

- `@zereight/mcp-gitlab` npm: https://www.npmjs.com/package/@zereight/mcp-gitlab
- MCP SSE transport spec: https://spec.modelcontextprotocol.io/specification/basic/transports/
- Notion MCP docs: check Notion settings → Connections for current UI
