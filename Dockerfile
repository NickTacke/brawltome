FROM postgres:16.8-alpine@sha256:3b057e1c2c6dfee60a30950096f3fab33be141dbb0fdd7af3d477083de94166c AS postgres
LABEL org.opencontainers.image.description="Brawlhalla player tracking" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/NickTacke/brawltome" \
      org.opencontainers.image.title="BrawlTome" \
      org.opencontainers.image.url="https://brawltome.app"
COPY --chmod=0555 infra/app/postgres/10-runtime-role.sh /docker-entrypoint-initdb.d/10-runtime-role.sh
COPY --chmod=0444 infra/app/postgres/20-pg-stat-statements.sql /docker-entrypoint-initdb.d/20-pg-stat-statements.sql
# Defaults (128 MB shared_buffers) left a 112 GB database at a ~60% cache hit ratio with 475 GB of temp spills.
# Sized for the 6 GB container limit in infra/app/compose.yml.
CMD ["postgres", \
     "-c", "shared_buffers=1536MB", \
     "-c", "effective_cache_size=4GB", \
     "-c", "work_mem=16MB", \
     "-c", "maintenance_work_mem=256MB", \
     "-c", "random_page_cost=1.1", \
     "-c", "effective_io_concurrency=200", \
     "-c", "track_io_timing=on", \
     "-c", "shared_preload_libraries=pg_stat_statements"]

FROM postgres AS dead-letter-role
COPY --chmod=0555 infra/app/postgres/configure-dead-letter-role.sh /usr/local/bin/configure-dead-letter-role
ENTRYPOINT ["/usr/local/bin/configure-dead-letter-role"]
CMD []

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS base
LABEL org.opencontainers.image.description="Brawlhalla player tracking" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/NickTacke/brawltome" \
      org.opencontainers.image.title="BrawlTome" \
      org.opencontainers.image.url="https://brawltome.app"
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/desktop/package.json apps/desktop/
COPY apps/discord-bot/package.json apps/discord-bot/
COPY apps/replay-bridge/package.json apps/replay-bridge/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
COPY packages/bhapi/package.json packages/bhapi/
COPY packages/telemetry/package.json packages/telemetry/
COPY packages/contexts/accounts/package.json packages/contexts/accounts/
COPY packages/contexts/player/package.json packages/contexts/player/
COPY packages/contexts/clan/package.json packages/contexts/clan/
COPY packages/contexts/ranking/package.json packages/contexts/ranking/
COPY packages/contexts/request-admission/package.json packages/contexts/request-admission/
COPY packages/contexts/refresh-operations/package.json packages/contexts/refresh-operations/
COPY packages/contexts/replay-analysis/package.json packages/contexts/replay-analysis/
COPY packages/contexts/statistics/package.json packages/contexts/statistics/
COPY packages/contexts/discovery/package.json packages/contexts/discovery/
COPY packages/game-data/package.json packages/game-data/
COPY packages/contracts/package.json packages/contracts/
COPY tooling/analytics-review/package.json tooling/analytics-review/
COPY tooling/architecture/package.json tooling/architecture/
COPY tooling/database-migrations/package.json tooling/database-migrations/
# bun 1.3.14 intermittently fails extracting large tarballs (e.g. next) at the default network concurrency.
RUN bun install --frozen-lockfile --network-concurrency 16 || bun install --frozen-lockfile --network-concurrency 16

FROM base AS build
COPY --from=install /app/node_modules node_modules
COPY --from=install /app/packages/contracts/node_modules packages/contracts/node_modules
COPY . .

FROM base AS migration
COPY --from=build /app .
USER bun
ENTRYPOINT ["/bin/sh", "infra/app/run-with-secrets.sh"]
CMD ["migration"]

FROM base AS dead-letter-cli
COPY --from=build /app .
USER bun
ENTRYPOINT ["/bin/sh", "infra/app/run-with-secrets.sh", "dead-letter-cli"]

FROM base AS api
COPY --from=build /app .
USER bun
STOPSIGNAL SIGTERM
ENTRYPOINT ["/bin/sh", "infra/app/run-with-secrets.sh"]
CMD ["api"]

FROM base AS operations-worker
COPY --from=build /app .
USER bun
STOPSIGNAL SIGTERM
ENTRYPOINT ["/bin/sh", "infra/app/run-with-secrets.sh"]
CMD ["operations-worker"]

FROM base AS discord-bot
COPY --from=build /app .
USER bun
STOPSIGNAL SIGTERM
ENTRYPOINT ["/bin/sh", "infra/app/run-with-secrets.sh"]
CMD ["discord-bot"]

FROM build AS web-build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ARG NEXT_PUBLIC_ANALYTICS_ENABLED=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_ANALYTICS_ENABLED=$NEXT_PUBLIC_ANALYTICS_ENABLED
RUN test -n "$NEXT_PUBLIC_API_URL" && bun run --filter @brawltome/web build

FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS web
LABEL org.opencontainers.image.description="Brawlhalla player tracking" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/NickTacke/brawltome" \
      org.opencontainers.image.title="BrawlTome" \
      org.opencontainers.image.url="https://brawltome.app"
WORKDIR /app
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=web-build --chown=node:node /app/infra/app/run-with-secrets.sh ./infra/app/run-with-secrets.sh
USER node
STOPSIGNAL SIGTERM
ENTRYPOINT ["/bin/sh", "infra/app/run-with-secrets.sh"]
CMD ["web"]
