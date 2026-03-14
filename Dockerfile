FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/discord-bot/package.json apps/discord-bot/
COPY packages/database/package.json packages/database/
COPY packages/bhapi/package.json packages/bhapi/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile --production

FROM base AS build
COPY --from=install /app/node_modules node_modules
COPY . .

FROM base AS runtime
COPY --from=build /app .
USER bun
