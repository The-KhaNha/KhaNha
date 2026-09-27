# syntax=docker/dockerfile:1
# The API image: docs/DEPLOYMENT.md "Containers". Build from server/:
#   docker build -t fp-api --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) server

FROM node:24-alpine AS deps
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

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
# The base image's `node` user, by number so the host can resolve it.
USER 1000:1000
EXPOSE 8000
# Through sh so $PORT expands; liveness only (no database), see GET /api/ready for readiness.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["sh", "-c", "wget -qO- \"http://127.0.0.1:${PORT:-8000}/api/health\" > /dev/null || exit 1"]
# Exec form: node is PID 1 and gets SIGTERM directly (graceful shutdown in src/server.ts).
CMD ["node", "dist/src/server.js"]
