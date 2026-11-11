# syntax=docker/dockerfile:1
# The web image: the built SPA behind nginx, configured at start from the environment (docs/DEPLOYMENT.md
# "Containers"). Build from client/:  docker build -t fp-web --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) client

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# corepack (shipped with Node 24) fetches the pnpm that package.json's packageManager pins.
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
ARG GIT_COMMIT=local
ENV GIT_COMMIT=$GIT_COMMIT
# Mode "container" builds with placeholder Supabase values (.env.container); nginx/runtime-env.sh supplies the real
# ones at start, so one image serves every environment.
# Then pre-compress at the highest level once, so nginx serves them with gzip_static instead of compressing each
# response at its fast default level (about 17% smaller JavaScript on the first visit).
RUN pnpm run build:container \
  && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.json' \) \
      -exec gzip -9 -k {} +

# Mainline nginx (nginx recommends it), slim: 21 packages instead of 71 and a third of the size, with every module
# this config uses. An old line stops getting Alpine updates (1.27 carried 210 fixable CVEs).
FROM nginxinc/nginx-unprivileged:1.31-alpine-slim
# The upstream image can lag Alpine's security releases by weeks; take the fixes at build time (as root), then go back
# to the image's nginx user (uid 101). COPY writes root-owned files whatever USER says.
USER 0
RUN apk upgrade --no-cache
USER 101
COPY --from=build /app/dist /usr/share/nginx/html
# The image's entrypoint renders every templates/**/*.template into conf.d/, substituting only variables that are set
# (so nginx's own $uri and $host survive).
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security.conf.template /etc/nginx/templates/snippets/security.conf.template
COPY --chmod=755 nginx/runtime-env.sh /docker-entrypoint.d/40-runtime-env.sh
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-qO", "/dev/null", "http://127.0.0.1:8080/healthz"]
