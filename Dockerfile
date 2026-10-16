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
    DATABASE_URL="postgres://shiftdesk_app:build-only@build.invalid:5432/build?sslmode=verify-full&sslrootcert=/app/db-ca.pem" \
    SESSION_SECRET=build-only-placeholder-never-used-at-run-time
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build with every tool, then keep only what runs (13.5): the linter, test runners, TypeScript's
# compiler and the like aren't in the image. tsx stays (a dependency): the worker and migrate run
# TypeScript with it.
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
# The app with its production dependencies only (the worker and migrate run TypeScript with tsx),
# owned by root: the app can't change its own code. Only Next's cache is writable by the app's user.
COPY --from=build /app /app
# The database's CA certificate isn't in the image: it's the host's, saved on the server as
# /opt/shiftdesk/secrets/db-ca.pem and mounted read-only at /app/db-ca.pem by
# deploy/docker-compose.yml.
# Every database connection is checked against it (sslmode=verify-full in .env; deploy/env.example).
RUN mkdir -p /app/.next/cache && chown -R node:node /app/.next/cache
# sharp re-encodes every photo and certificate image (src/lib/uploads/image.ts; 12F.2) with its own
# native image library, installed by npm ci for this platform. Load it here, so an image without it
# fails to build instead of failing the first casual who uploads a photo.
RUN node -e "require('sharp')"
# The worker and migrate start with tsx (deploy/docker-compose.yml): an image without it fails here.
RUN node --import tsx -e "" && test ! -e node_modules/vitest && test ! -e node_modules/eslint
# Never root.
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
