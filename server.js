/**
 * mcp-gitlab-gateway
 *
 * Thin HTTP proxy in front of @zereight/mcp-gitlab running in
 * --streamable-http + --remote-auth mode.
 *
 * Clients connect to:  POST /mcp?token=GITLAB_PERSONAL_ACCESS_TOKEN
 * Gateway forwards to: http://localhost:UPSTREAM_PORT/mcp
 *                      with Authorization: Bearer <token>
 *
 * This lets Notion (which only accepts a URL, no custom headers) pass
 * per-user GitLab PATs via query string while the upstream server handles
 * all MCP protocol logic.
 */

const http = require("http");
const { URL } = require("url");

const PORT = parseInt(process.env.PORT || "8808", 10);
const UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT || "3002", 10);
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "127.0.0.1";

function proxyRequest(req, res, token) {
  const upstreamOptions = {
    hostname: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    path: "/mcp",
    method: req.method,
    headers: {
      ...req.headers,
      host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
      authorization: `Bearer ${token}`,
    },
  };

  const upstreamReq = http.request(upstreamOptions, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstreamReq.on("error", (err) => {
    console.error(`[proxy] Upstream error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Upstream unavailable", detail: err.message }));
    }
  });

  req.pipe(upstreamReq);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", upstream: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` }));
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const token = url.searchParams.get("token");
  if (!token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing ?token= query parameter" }));
    return;
  }

  proxyRequest(req, res, token);
});

server.listen(PORT, () => {
  console.log(`mcp-gitlab-gateway listening on http://localhost:${PORT}`);
  console.log(`  MCP endpoint: http://localhost:${PORT}/mcp?token=YOUR_GITLAB_TOKEN`);
  console.log(`  Upstream:     http://${UPSTREAM_HOST}:${UPSTREAM_PORT}/mcp`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
});

process.on("SIGTERM", () => { server.close(); process.exit(0); });
process.on("SIGINT",  () => { server.close(); process.exit(0); });
