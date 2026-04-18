FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/discord-bot/package.json apps/discord-bot/
COPY packages/database/package.json packages/database/
COPY packages/bhapi/package.json packages/bhapi/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/contexts/player/package.json packages/contexts/player/
COPY packages/contexts/clan/package.json packages/contexts/clan/
COPY packages/contexts/ranking/package.json packages/contexts/ranking/
COPY packages/contexts/identity/package.json packages/contexts/identity/
COPY packages/contexts/matchmaking/package.json packages/contexts/matchmaking/
COPY packages/replay-format/package.json packages/replay-format/
COPY packages/game-data/package.json packages/game-data/
RUN bun install

FROM base AS build
COPY --from=install /app/node_modules node_modules
COPY . .

FROM base AS api
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app .
USER bun
CMD ["bun", "run", "apps/api/src/serve.ts"]

FROM base AS worker
COPY --from=build /app .
USER bun
CMD ["bun", "run", "apps/api/src/worker.ts"]

FROM base AS discord-bot
COPY --from=build /app .
USER bun
CMD ["bun", "run", "apps/discord-bot/src/index.ts"]
