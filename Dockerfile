# The ShiftDesk image (Phase 8; docs/architecture.md "Deployment"). One image for all three: the
# web app (the default command), the job worker and the one-off migration step (their commands are
# in deploy/docker-compose.yml). Built by GitHub Actions (.github/workflows/deploy.yml) and pulled
# by the server (deploy/deploy.sh). No secrets in it: they come from the server's .env at run time.

# Node 22, as .nvmrc. (Pin a digest once the image is in use: docker buildx imagetools inspect.)
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Placeholders so the build never trips over the app's settings check; build stage only (the
# runtime stage below starts afresh, and the server's .env gives the real values).
ENV NEXT_TELEMETRY_DISABLED=1 \
    APP_BASE_DOMAIN=build.invalid \
    DATABASE_URL=postgres://shiftdesk_app:build-only@build.invalid:5432/build \
    SESSION_SECRET=build-only-placeholder-never-used-at-run-time
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
# The whole app with its dependencies (the worker and migrate run TypeScript with tsx), owned by
# root: the app can't change its own code. Only Next's cache is writable by the app's user.
COPY --from=build /app /app
RUN mkdir -p /app/.next/cache && chown -R node:node /app/.next/cache
# Never root.
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
