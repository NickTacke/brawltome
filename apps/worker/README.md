# Brawltome Worker

Background worker for BrawlTome. Runs:

- BullMQ consumer(s) for `refresh-queue`
- Scheduled janitor maintenance (cron)

## Environment Variables

Copy `apps/worker/.env.example` to `apps/worker/.env` and fill in required values:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/brawltome?schema=public"
BRAWLHALLA_API_KEY="your-api-key"
REDIS_URL="redis://localhost:6379"
```

## Running the Worker

```bash
pnpm dev:worker
```
