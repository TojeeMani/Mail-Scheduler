# Production-Grade Email Job Scheduler

A robust, distributed email scheduling system built with Node.js, Next.js, BullMQ, and Redis. Designed for high availability and restart safety.

## 🚀 Key Features

- **Google OAuth Login**: Real Google authentication (not mock).
- **Normalized Persistence**: `emails` (content) and `email_jobs` (execution tracking) tables for strict data integrity.
- **BullMQ Orchestration**: Handles 1000+ jobs with ease. NO cron jobs used.
- **Production Rate Limiting**: Redis-backed hourly limits (`email_rate:{senderId}:{YYYYMMDDHH}`).
- **Restart Safety**: System survives server crashes without losing or duplicating jobs.
- **Dynamic Campaign Controls**: Set custom hourly limits and minimum delays per campaign.

## 🛠 Tech Stack

- **Backend**: TypeScript, Express, BullMQ, Prisma (PostgreSQL), Nodemailer.
- **Frontend**: Next.js, Tailwind CSS, Google OAuth.
- **Infrastructure**: Redis, PostgreSQL, Docker.

## ⚙️ Getting Started

### 1. Infrastructure (Docker)
Ensure Docker is running and start the services:
```bash
docker compose up -d
```

### 2. Configuration (`.env`)
Create/Update configuration files:

**`apps/api/.env`**:
```env
PORT=3001
DATABASE_URL="postgresql://user:password@localhost:5432/email_scheduler"
REDIS_HOST=localhost
REDIS_PORT=6379
GOOGLE_CLIENT_ID="your-client-id"
ETHEREAL_EMAIL="your-ethereal-user"
ETHEREAL_PASS="your-ethereal-pass"
WORKER_CONCURRENCY=5
```

**`apps/web/.env.local`**:
```env
NEXT_PUBLIC_API_URL="http://127.0.0.1:3001"
NEXT_PUBLIC_GOOGLE_CLIENT_ID="your-client-id"
```

### 3. Build & Start
```bash
npm install
cd apps/api && npx prisma db push
cd ../..
npm run dev
```

## 🏗 Architecture & Design

### Scheduling Logic
1. **DB First**: Every email request is first persisted in the `emails` table.
2. **Execution Tracking**: A corresponding entry is made in `email_jobs`.
3. **Queueing**: Jobs are added to BullMQ with a `delay` calculated from `scheduledAt - Date.now()`.
4. **Idempotency**: The worker fetches the DB record first. If `status === 'SENT'`, it skips processing.

### Rate Limiting Strategy
We use a **Redis-backed hourly bucket** approach:
- Key: `email_rate:{userId}:{YYYYMMDDHH}`
- Logic: `INCR` key on reach attempt.
- If `count > limit`, the job is moved back to `delayed` state for the next available hour using `job.moveToDelayed()`.
- Resets automatically via Redis TTL (2 hours).

### Restart Safety
- **Persistent Jobs**: BullMQ jobs live in Redis and are not lost if the Node process restarts.
- **DB State Recovery**: Upon restart, the worker re-verifies each job's status against the PostgreSQL source of truth before sending.

## 🧪 Verification Scenarios

1. **Survival Check**: Schedule an email for +10 mins. Restart the API server. Verification: The job will still execute exactly 10 minutes after creation.
2. **Limit Check**: Set "Emails Per Hour" to 1. Schedule 2 emails. Verification: The second email will be delayed by 1 hour.
3. **Delay Check**: Set "Min Delay" to 5000ms. Verification: Observe logs for exactly 5s gap between sends.
