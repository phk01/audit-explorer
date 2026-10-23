# Audit Explorer — single image: API + built web app. PostgreSQL runs as a separate service (see docker-compose.yml).
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /src
# argon2 ships prebuilt binaries for linux-x64/arm64 glibc; python/make/g++ are only needed as a fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ipdata/package.json packages/ipdata/
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
COPY apps ./apps
RUN pnpm -r build
# Prune dev dependencies for the runtime image
RUN pnpm --filter @audit/api --prod deploy --legacy /out/api \
 && test -f /out/api/dist/src/server.js && test -d /out/api/migrations \
 && cp -r apps/web/dist /out/web

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIST=/app/web
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./api
COPY --from=build --chown=node:node /out/web ./web
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "api/dist/src/server.js"]
