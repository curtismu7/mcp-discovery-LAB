# Stage 1 builds web/dist; stage 2 is the runtime: API server + the built UI. Pattern from hostile-mcp.
# Demo mode only: no ps, lsof or docker CLI in the image, so even MCP_DISCOVERY_LIVE=1 could not see a host from here.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --ignore-scripts
COPY web web
RUN npm run build -w web

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production MCP_DISCOVERY_PORT=5310
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server --ignore-scripts && npm cache clean --force
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 5310
# Inside the container the server must listen on all interfaces, so MCP_DISCOVERY_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV MCP_DISCOVERY_BIND=0.0.0.0
CMD ["node", "server/src/index.js"]
