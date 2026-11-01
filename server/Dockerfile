# syntax=docker/dockerfile:1
# The API image: docs/DEPLOYMENT.md "Containers". Build from server/:
#   docker build -t fp-api --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) server
# Every node:24-alpine3.24 and alpine:3.24 below must name the same Alpine release: the runtime copies the node binary
# out of the Node image, and it needs the C and C++ libraries it was built against.

FROM node:24-alpine3.24 AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# --ignore-scripts skips the Supabase CLI binary: the image never runs it.
RUN npm ci --ignore-scripts

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
# dist/scripts stays, so staging can be seeded with `node dist/scripts/seed.js` (it refuses APP_ENV=production).
RUN npm run build

FROM node:24-alpine3.24 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts

# Plain Alpine and the node binary: npm, npx, corepack and yarn (24 MB, with advisories of their own) never ship, and
# apk upgrade takes Alpine's fixes at build time, which a base image can lag by weeks.
FROM alpine:3.24 AS runtime
# libstdc++ is unpinned on purpose: Alpine drops old versions from its index, so a pinned one breaks the build.
# hadolint ignore=DL3018
RUN apk upgrade --no-cache && apk add --no-cache libstdc++ \
  && addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NODE_ENV=production
# GET /api/health reads the version from package.json.
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
# A `node` user like the Node image's, by number so the host can resolve it.
USER 1000:1000
EXPOSE 8000
# Through sh so $PORT expands; liveness only (no database), see GET /api/ready for readiness.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["sh", "-c", "wget -qO- \"http://127.0.0.1:${PORT:-8000}/api/health\" > /dev/null || exit 1"]
# Exec form: node is PID 1 and gets SIGTERM directly (graceful shutdown in src/server.ts).
CMD ["node", "dist/src/server.js"]
