# Brawltome Web

The frontend application for Brawltome, built with [Next.js](https://nextjs.org/) and Tailwind CSS.

## Features

- **Player Profiles**: Detailed view of player stats, legend usage, and ranked history.
- **Leaderboards**: Global and regional rankings.
- **Responsive Design**: Optimized for desktop and mobile.
- **Dark Mode**: Built-in theme support.

## Environment Variables

Copy `apps/web/.env.example` to `apps/web/.env.local` and set:

```env
NEXT_PUBLIC_API_URL="http://localhost:3000/api"
```

## Running the Web App

```bash
pnpm dev:web
```
