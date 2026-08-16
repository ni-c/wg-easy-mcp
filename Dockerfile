# Build stage
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Runtime
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43
WORKDIR /app
ENV NODE_ENV=production

# The entrypoint is plain `node`, so npm is dead weight here — and its vendored
# dependency tree (tar, brace-expansion, ip-address, an old undici) is what a
# container scan of this image actually trips over. None of it is reachable at
# runtime, so remove it rather than carrying known-vulnerable code around.
RUN rm -rf /usr/local/lib/node_modules/npm \
  /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The server reports its version from package.json at runtime (src/server.ts).
# The lockfile is deliberately not copied: nothing installs in this image, and
# it would only widen the scan surface to the dev dependency tree.
COPY package.json ./

# Ownership proof for the MCP Registry: must match server.json's name.
LABEL io.modelcontextprotocol.server.name="io.github.ni-c/wg-easy-mcp"

# Drop root: the node image ships an unprivileged `node` user (uid 1000).
USER node

# stdio transport only — no port, no healthcheck. The server starts without
# WG_EASY_* credentials (tools are listable); calls fail with a helpful message.
ENTRYPOINT ["node", "dist/index.js"]
