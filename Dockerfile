# mcp-gitlab-gateway — the thin Node.js proxy (server.js).
#
# This image runs ONLY the gateway. The upstream @zereight/mcp-gitlab runs as a
# separate compose service (see docker-compose snippet in DEPLOY.md).
#
# server.js has zero runtime npm dependencies (pure Node stdlib).

FROM node:24-slim

WORKDIR /app

COPY server.js usage.js ./

# Create the stats data dir owned by node. When an empty named volume is mounted
# here, Docker seeds it with this dir's ownership, so the node user can write.
RUN mkdir -p /data && chown node:node /data

# node:24-slim already ships a non-root "node" user at uid 1000.
USER node

EXPOSE 8808

CMD ["node", "server.js"]
