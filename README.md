<p align="center">
  <img src="apps/web/public/images/logo.png" alt="BrawlTome logo" width="320" />
</p>

BrawlTome is a comprehensive Brawlhalla tracking application built with a modern monorepo architecture. It provides player statistics, rankings, and detailed insights into Brawlhalla gameplay.

## 🏗 Project Structure

This project is organized as an [Nx](https://nx.dev) monorepo:

- **apps/api**: NestJS backend application handling data synchronization, caching, and serving the REST API.
- **apps/web**: Next.js frontend application providing the user interface.
- **libs/bhapi-client**: A dedicated client library for interacting with the Brawlhalla API.
- **libs/database**: Prisma ORM setup and database utilities.
- **libs/shared-types**: Shared TypeScript interfaces and DTOs used across frontend and backend.
- **libs/ui**: Shared UI components (built with Shadcn UI/Radix UI).

## 🛠 Tech Stack

- **Framework**: [NestJS](https://nestjs.com/) (Backend), [Next.js](https://nextjs.org/) (Frontend)
- **Language**: TypeScript
- **Database**: PostgreSQL with [Prisma](https://www.prisma.io/)
- **Styling**: Tailwind CSS
- **Tools**: Nx, ESLint, Prettier

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- PostgreSQL
- Redis (for queue management)
- Brawlhalla API Key (Get one at [dev.brawlhalla.com](https://dev.brawlhalla.com/))

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/NickTacke/brawltome
   cd brawltome
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Start local dependencies (optional but recommended):

   ```bash
   docker compose up -d
   ```

4. Environment Setup:
   Copy the example env files and fill in required values:
   - `apps/api/.env.example` → `apps/api/.env`
   - `apps/worker/.env.example` → `apps/worker/.env`
   - `apps/web/.env.example` → `apps/web/.env.local`

### Running the Application

Start the development servers:

```bash
# Start the API
pnpm dev:api

# Start the Worker
pnpm dev:worker

# Start the Web App
pnpm dev:web
```

### Seeding Data

Populate the database with initial static data (Legends, etc.):

```bash
pnpm seed:legends
```

## 📜 Scripts

- `pnpm seed:api`: Run general API seeder.
- `pnpm seed:legends`: Seed static Legend data from the Brawlhalla API.
- `pnpm lint`: Lint all projects.
- `pnpm typecheck`: Typecheck all projects.
- `pnpm build`: Build all projects.
- `pnpm format`: Format all projects.
- `pnpm format:check`: Verify formatting for all projects.
- `npx nx graph`: Visualize the project dependency graph.
