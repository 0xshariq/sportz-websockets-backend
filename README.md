# Sportz Live Sports Backend

A production-oriented Express and WebSocket backend for live sports matches and commentary, backed by PostgreSQL and Drizzle ORM.

## Features

- REST APIs for matches, scores, and commentary
- Match listing filters by status and sport
- Match detail endpoint with time-derived status
- Ascending or descending commentary pagination
- WebSocket subscriptions at `/ws`
- Match-specific score, commentary, creation, and status-change broadcasts
- Arcjet protection for HTTP and WebSocket upgrades
- Zod validation for request payloads and environment variables
- PostgreSQL connection pooling with Drizzle ORM
- Health and readiness endpoints
- Graceful shutdown for HTTP, WebSocket, and database connections
- Security headers, request-size limits, rate limits, and WebSocket heartbeats
- Database indexes and cascading commentary cleanup

## Requirements

- Node.js `>=22.21.0 <23` or `>=24.5.0`
- pnpm
- PostgreSQL
- Arcjet key for protected development/production environments

## Setup

```bash
pnpm install
cp .env.example .env
```

Set `DATABASE_URL` and `ARCJET_KEY` in `.env`. Use `ARCJET_MODE=DRY_RUN` for local development when appropriate. `MATCH_COUNT=0` seeds all configured matches; a positive value limits the number of seed matches.

## Commands

The server automatically synchronizes every non-finished match every 30 seconds using its UTC `startTime` and `endTime`. Status changes are persisted to PostgreSQL and emitted to subscribers as `match_status_updated` WebSocket events.

```bash
pnpm dev             # Start with file watching
pnpm start           # Start the server
pnpm test            # Run validation tests
pnpm check           # Check key JavaScript files
pnpm db:generate     # Generate Drizzle migrations
pnpm db:migrate      # Apply migrations
pnpm db:studio       # Open Drizzle Studio
pnpm seed            # Seed sample data
```

## Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | required |
| `PORT` | HTTP port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `API_URL` | Public HTTP URL used in deployment | local URL |
| `NODE_ENV` | `development`, `test`, or `production` | `development` |
| `ARCJET_KEY` | Arcjet project key | optional in local dry-run |
| `ARCJET_MODE` | `LIVE` or `DRY_RUN` | `LIVE` |
| `ARCJET_ENV` | Arcjet environment label | `development` |
| `BROADCAST` | Broadcast feature flag | `true` |
| `DELAY_MS` | Optional broadcast/seed delay | `250` |
| `MATCH_COUNT` | Optional seed match count | `0` |

## API

- `GET /` — service metadata
- `GET /health` — liveness status
- `GET /ready` — database readiness status
- `GET /matches?limit=50&status=live&sport=football` — list and filter matches
- `GET /matches/:id` — get one match; status is recalculated from timestamps when available
- `POST /matches` — create a match
- `PATCH /matches/:id/score` — update a live match score
- `GET /matches/:id/commentary?limit=10&sort=desc` — list commentary in ascending or descending creation order
- `POST /matches/:id/commentary` — add commentary

### Match status automation

Every 30 seconds, the background synchronizer evaluates each match using its UTC timestamps:

- `scheduled` — the start time has not been reached
- `live` — the current time is between `startTime` and `endTime`
- `finished` — the end time has passed

Only changed statuses are written to PostgreSQL. Each change is also broadcast to clients subscribed to that match as a `match_status_updated` event. The synchronizer is stopped during graceful shutdown to avoid open timers during deployment or restart.

## WebSocket protocol

Connect to `ws://localhost:3000/ws` or `wss://your-domain/ws`.

Subscribe:

```json
{"type":"subscribe","matchId":1}
```

Unsubscribe:

```json
{"type":"unsubscribe","matchId":1}
```

Events include `welcome`, `subscribed`, `unsubscribed`, `match_created`, `match_status_updated`, `score_update`, `commentary`, and `error`.

## Production deployment

Apply migrations before starting the service:

```bash
pnpm db:migrate
pnpm start
```

The included `Dockerfile` provides a production container. For containerized deployments, build and run the dedicated migration target before starting the default production target:

```bash
docker build --target migrator -t sportz-migrator .
docker run --rm --env-file .env sportz-migrator
docker build --target production -t sportz-backend .
docker run --rm --env-file .env -p 3000:3000 sportz-backend
```

Configure all secrets through the deployment platform rather than committing `.env` files. Keep `ARCJET_MODE=LIVE`, use TLS at the edge, and monitor `/health` and `/ready`.

## Project structure

- `src/index.js` — application entrypoint and lifecycle
- `src/routes/` — REST route handlers
- `src/ws/` — WebSocket server and broadcast functions
- `src/db/` — Drizzle schema and PostgreSQL pool
- `src/validation/` — Zod request schemas
- `src/middleware/` — shared Express error handling
- `drizzle/` — database migrations
- `test/` — automated validation tests
