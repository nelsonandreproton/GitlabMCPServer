# mcp-gitlab-gateway — the thin Node.js proxy (server.js).
#
# This image runs ONLY the gateway. The upstream @zereight/mcp-gitlab runs as a
# separate compose service (see docker-compose snippet in DEPLOY.md).
#
# server.js has zero runtime npm dependencies (pure Node stdlib).

FROM node:24-slim

WORKDIR /app

COPY server.js ./

# Non-root (uid 1000)
RUN useradd -u 1000 -m appuser
USER appuser

EXPOSE 8808

CMD ["node", "server.js"]
