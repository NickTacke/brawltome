FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/discord-bot/package.json apps/discord-bot/
COPY packages/database/package.json packages/database/
COPY packages/bhapi/package.json packages/bhapi/
COPY packages/shared/package.json packages/shared/
COPY packages/telemetry/package.json packages/telemetry/
COPY packages/ui/package.json packages/ui/
COPY packages/contexts/accounts/package.json packages/contexts/accounts/
COPY packages/contexts/player/package.json packages/contexts/player/
COPY packages/contexts/clan/package.json packages/contexts/clan/
COPY packages/contexts/ranking/package.json packages/contexts/ranking/
COPY packages/contexts/request-admission/package.json packages/contexts/request-admission/
COPY packages/contexts/refresh-operations/package.json packages/contexts/refresh-operations/
COPY packages/contexts/statistics/package.json packages/contexts/statistics/
COPY packages/contexts/discovery/package.json packages/contexts/discovery/
COPY packages/contexts/matchmaking/package.json packages/contexts/matchmaking/
COPY packages/replay-format/package.json packages/replay-format/
COPY packages/game-data/package.json packages/game-data/
COPY packages/contracts/package.json packages/contracts/
COPY tooling/database-migrations/package.json tooling/database-migrations/
RUN bun install

FROM base AS build
COPY --from=install /app/node_modules node_modules
COPY . .

FROM base AS migration
COPY --from=build /app .
USER bun
CMD ["bun", "run", "db:migrate"]

FROM base AS api
COPY --from=build /app .
USER bun
STOPSIGNAL SIGTERM
CMD ["bun", "run", "apps/api/src/serve.ts"]

FROM base AS operations-worker
COPY --from=build /app .
USER bun
STOPSIGNAL SIGTERM
CMD ["bun", "run", "apps/api/src/operations-worker.ts"]

FROM base AS discord-bot
COPY --from=build /app .
USER bun
STOPSIGNAL SIGTERM
CMD ["bun", "run", "apps/discord-bot/src/index.ts"]
