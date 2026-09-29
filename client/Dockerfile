# syntax=docker/dockerfile:1
# The web image: the built SPA behind nginx, configured at start from the environment (docs/DEPLOYMENT.md
# "Containers"). Build from client/:  docker build -t fp-web --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) client

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
ARG GIT_COMMIT=local
ENV GIT_COMMIT=$GIT_COMMIT
# Mode "container" builds with placeholder Supabase values (.env.container); nginx/runtime-env.sh supplies the real
# ones at start, so one image serves every environment.
# Then pre-compress at the highest level once, so nginx serves them with gzip_static instead of compressing each
# response at its fast default level (about 17% smaller JavaScript on the first visit).
RUN npm run build:container \
  && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.json' \) \
      -exec gzip -9 -k {} +

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# The image's entrypoint renders every templates/**/*.template into conf.d/, substituting only variables that are set
# (so nginx's own $uri and $host survive).
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security.conf.template /etc/nginx/templates/snippets/security.conf.template
COPY --chmod=755 nginx/runtime-env.sh /docker-entrypoint.d/40-runtime-env.sh
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-qO", "/dev/null", "http://127.0.0.1:8080/healthz"]
