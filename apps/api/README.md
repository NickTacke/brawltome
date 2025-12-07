# Brawltome API

The backend service for Brawltome, built with [NestJS](https://nestjs.com/).

## Features

- **Player Search & Stats**: Fetch and aggregate player data from the Brawlhalla API.
- **Queue System**: Background job processing for updating player statistics using Bull/Redis.
- **Database**: Persistent storage for player history and rankings using PostgreSQL.
- **Caching**: Optimized data retrieval.

## Environment Variables

Create a `.env` file in this directory with the following variables:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/brawltome?schema=public"
BRAWLHALLA_API_KEY="your-api-key"
REDIS_HOST="localhost"
REDIS_PORT=6379
```

## Running the API

```bash
npx nx serve api
```

