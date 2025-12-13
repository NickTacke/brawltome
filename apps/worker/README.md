# Brawltome Worker

Background worker for BrawlTome. Runs:

- BullMQ consumer(s) for `refresh-queue`
- Scheduled janitor maintenance (cron)

## Environment Variables

Create a `.env` file in this directory with at least:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/brawltome?schema=public"
BRAWLHALLA_API_KEY="your-api-key"
REDIS_URL="redis://localhost:6379"
```

## Running the Worker

```bash
pnpm exec nx serve worker
```


