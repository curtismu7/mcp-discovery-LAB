# Demo mode only: no ps, lsof or docker CLI in the image, so even MCP_DISCOVERY_LIVE=1 could not see a host from here.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production MCP_DISCOVERY_PORT=5310
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev -w server --ignore-scripts && npm cache clean --force
COPY server/src server/src
USER node
EXPOSE 5310
# Inside the container the server must listen on all interfaces, so MCP_DISCOVERY_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV MCP_DISCOVERY_BIND=0.0.0.0
CMD ["node", "server/src/index.js"]
