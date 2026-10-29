# Build stage
#
# node:26-alpine is the ACTIVE LTS line, not the newest tag — roughly half of all
# Node majors never become LTS, so "newest" and "supported" are different things.
# Only the major belongs in this note. A patch version written here would be
# falsified by the next digest bump, which would arrive red for a reason nobody
# needs to act on. CI checks the claim instead, on every run
# (.github/scripts/check-base-image-pin.sh): `node:lts-alpine` and
# `node:26-alpine` must resolve to the same digest, and the digest pinned below
# must be a Node 26 image. The day 26 leaves LTS, that fails.
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Runtime
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94
WORKDIR /app
ENV NODE_ENV=production

# The entrypoint is plain `node`, so npm is dead weight here — and its vendored
# dependency tree (tar, brace-expansion, ip-address, an old undici) is what a
# container scan of this image actually trips over. None of it is reachable at
# runtime, so remove it rather than carrying known-vulnerable code around.
#
# corepack and yarn go with it, for the same reason and by the same argument:
# the base image ships them, nothing here runs them, and corepack vendors its
# own dependency tree. Removing npm by hand and stopping there is the third time
# this has happened in the family — check with
# `docker run --rm --entrypoint sh <image> -c 'ls /opt /usr/local/lib/node_modules; which yarn npm npx corepack'`
# after a build, not by reading this line.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*

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
