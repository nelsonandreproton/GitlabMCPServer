# mcp-gitlab-gateway — the thin Node.js proxy (server.js).
#
# This image runs ONLY the gateway. The upstream @zereight/mcp-gitlab runs as a
# separate compose service (see docker-compose snippet in DEPLOY.md).
#
# server.js has zero runtime npm dependencies (pure Node stdlib).

FROM node:24-slim

WORKDIR /app

COPY server.js usage.js ./

# node:24-slim already ships a non-root "node" user at uid 1000.
USER node

EXPOSE 8808

CMD ["node", "server.js"]
