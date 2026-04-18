FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/ui/package.json packages/ui/
COPY packages/database/package.json packages/database/
COPY packages/bhapi/package.json packages/bhapi/
COPY packages/shared/package.json packages/shared/
COPY packages/contexts/player/package.json packages/contexts/player/
COPY packages/contexts/clan/package.json packages/contexts/clan/
COPY packages/contexts/ranking/package.json packages/contexts/ranking/
COPY packages/contexts/identity/package.json packages/contexts/identity/
COPY packages/contexts/matchmaking/package.json packages/contexts/matchmaking/
COPY packages/replay-format/package.json packages/replay-format/
RUN bun install

FROM base AS build
COPY --from=install /app/node_modules node_modules
COPY apps/web/ apps/web/
COPY packages/ui/ packages/ui/
COPY apps/api/src/router/ apps/api/src/router/
COPY apps/api/src/trpc/ apps/api/src/trpc/
COPY apps/api/package.json apps/api/
COPY packages/contexts/ packages/contexts/
COPY packages/database/src/ packages/database/src/
COPY packages/database/package.json packages/database/
COPY packages/bhapi/src/ packages/bhapi/src/
COPY packages/bhapi/package.json packages/bhapi/
COPY packages/shared/src/ packages/shared/src/
COPY packages/shared/package.json packages/shared/
COPY tsconfig.json .
RUN cd apps/web && bun run build

FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/apps/web
COPY --from=build /app/apps/web/.next .next
COPY --from=build /app/apps/web/public public
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/web/package.json .
COPY --from=build /app/apps/web/next.config.ts .
USER bun
CMD ["bun", "run", "start"]
