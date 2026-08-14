# Sportz Live Sports Backend Context

This document explains the backend as it exists in this repository, including the REST API, PostgreSQL/Drizzle data layer, seed process, WebSocket protocol, HTTP-to-WebSocket upgrade lifecycle, security controls, and frontend integration guidance.

## 1. Runtime and entrypoints

The project is an ES module Node.js application. `src/index.js` is the main application module and exports the HTTP server. `src/bootstrap.js` is the normal local/process entrypoint; it loads runtime configuration and starts the service through the application bootstrap flow. The package scripts are:

- `pnpm dev`: starts the bootstrap process with Node watch mode.
- `pnpm start`: starts the production bootstrap process.
- `pnpm seed`: runs `src/seed/seed.js`, which inserts fixture data by calling the HTTP API.
- `pnpm test`: runs Node's built-in test runner.
- `pnpm check`: syntax-checks the main HTTP and WebSocket modules.
- `pnpm db:generate`: generates Drizzle migrations from the schema.
- `pnpm db:migrate`: applies migrations to PostgreSQL.

The server creates one Express application and one Node `http.Server`:

```js
const app = express();
const server = http.createServer(app);
```

Using one HTTP server is important: Express handles normal HTTP requests, while the `ws` package uses the same server's `upgrade` event for WebSocket requests.

## 2. Startup sequence

When `src/index.js` loads:

1. Configuration is parsed by `src/config.js` using Zod. `DATABASE_URL` is required. `PORT` defaults to `3000`; `HOST` defaults to `0.0.0.0`.
2. `src/db/db.js` creates a PostgreSQL pool with a maximum of 20 connections, a 30-second idle timeout, and a one-hour connection lifetime. Drizzle wraps that pool.
3. Express disables `x-powered-by`.
4. Baseline security response headers are installed.
5. JSON parsing is enabled with a 256 KB request limit.
6. Arcjet HTTP protection middleware is registered.
7. Health and readiness routes are registered.
8. REST routers are mounted.
9. `attachWebSocketServer(server)` attaches the WebSocket upgrade listener and returns broadcast/close functions. Those functions are placed on `app.locals` so route handlers can publish events without importing the WebSocket implementation.
10. 404 and error handlers are registered last.
11. Outside Vercel, the HTTP server listens on the configured host and port.

The server handles `SIGTERM` and `SIGINT` by stopping WebSocket clients, closing the HTTP server, ending the database pool, and then exiting.

## 3. Database model

The PostgreSQL schema is defined in `src/db/schema.js` and migrated through the `drizzle/` directory.

### `matches`

- `id`: serial primary key.
- `sport`: required text such as `football`, `cricket`, or `basketball`.
- `home_team`, `away_team`: required team names.
- `status`: PostgreSQL enum: `scheduled`, `live`, or `finished`.
- `start_time`, `end_time`: timestamps used to calculate current status.
- `home_score`, `away_score`: non-null integer scores defaulting to zero.
- `created_at`: creation timestamp.

Indexes exist for `created_at` and `status`.

### `commentary`

- `id`: serial primary key.
- `match_id`: required foreign key to `matches.id`; deleting a match cascades to its commentary.
- `minute`: nonnegative event minute.
- `sequence`: optional event ordering value.
- `period`: text such as `1st half` or `1st innings`.
- `event_type`: text such as `goal`, `wicket`, or `boundary`.
- `actor`: player or participant involved.
- `team`: team associated with the event.
- `message`: required human-readable text.
- `metadata`: JSONB for sport-specific details such as runs or points.
- `tags`: PostgreSQL text array for filtering or presentation labels.
- `created_at`: insertion timestamp.

An index exists on `(match_id, created_at)` for match commentary reads.

## 4. REST API

All successful API responses use a `data` property. Validation failures return a 400 response with an `error` message and Zod `details`. Unknown routes return 404. Unexpected errors are logged server-side and returned as `Internal server error`.

### `GET /`

Returns service metadata:

```json
{"name":"sportz-live-sports-dashboard","status":"ok"}
```

### `GET /health`

A liveness endpoint. It returns `status`, process `uptime`, and the configured environment. It does not query the database.

### `GET /ready`

A readiness endpoint. It executes `select 1` through the PostgreSQL pool. A successful response means the process can reach the database; a failure goes through the shared error handler.

### `GET /matches?limit=50`

Returns matches ordered by newest `created_at` first. `limit` is a positive integer and is capped at 100. For matches with valid start and end times, the returned status is calculated dynamically by `getMatchStatus`; this avoids serving a stale status from the stored enum.

Frontend example:

```js
const response = await fetch('/matches?limit=50');
const { data: matches } = await response.json();
```

### `POST /matches`

Creates a match after validating sport, teams, ISO timestamps, and optional nonnegative scores. `endTime` must be later than `startTime`. The stored status is computed from the time window. After the database insert succeeds, the route calls `app.locals.broadcastMatchCreated`, which publishes the new match to every connected WebSocket client.

### `PATCH /matches/:id/score`

Validates the numeric match ID and nonnegative integer scores. It loads the match, synchronizes its time-based status, and only updates a match whose status is currently `live`. A successful update publishes a match-specific `score_update` event.

### `GET /matches/:id/commentary?limit=10`

Validates the match ID and positive limit, capped at 100. It returns commentary for that match ordered newest first by `created_at`.

### `POST /matches/:id/commentary`

Validates the match ID and commentary payload, confirms the match exists, inserts the event, and publishes the inserted row to WebSocket subscribers for that match. The request body must include `minute` and `message`; other fields are optional.

## 5. Status calculation

`src/utils/match-status.js` derives status from the current time and the match window:

- before `startTime`: `scheduled`
- at or after `startTime` and before `endTime`: `live`
- at or after `endTime`: `finished`

The score route calls status synchronization before allowing a score update. This means a match that has naturally ended cannot continue receiving score updates merely because its database enum has not yet been manually changed.

## 6. WebSocket endpoint

The WebSocket endpoint is `/ws` on the same host and port as HTTP:

- local unencrypted connection: `ws://localhost:3000/ws`
- TLS deployment: `wss://your-domain/ws`

The server uses `new WebSocketServer({ noServer: true, path: '/ws' })`. `noServer: true` means `ws` does not create another TCP listener. Node's existing HTTP server owns the socket and explicitly hands valid upgrade requests to `wss.handleUpgrade`.

## 7. Exactly how HTTP upgrades into WebSocket

A browser starts with an HTTP request, not a WebSocket frame. For example, a WebSocket client requests:

```http
GET /ws HTTP/1.1
Host: localhost:3000
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <random-key>
Sec-WebSocket-Version: 13
```

The sequence in this backend is:

1. The TCP connection reaches the Node HTTP server.
2. Because the request has `Connection: Upgrade` and `Upgrade: websocket`, Node emits the server's `upgrade` event instead of dispatching the request through Express route handlers.
3. The handler parses `req.url` using the forwarded protocol and incoming `Host` header. This allows local HTTP, reverse-proxy HTTP, and HTTPS deployments to resolve the path correctly.
4. Only pathname `/ws` is accepted. Any other upgrade path receives a raw HTTP 404 response and the socket is destroyed.
5. If WebSocket Arcjet protection is configured, the upgrade request is checked before protocol negotiation. A denied rate limit returns 429; another denial returns 403; a protection failure returns 500. In every case the raw socket is closed.
6. `wss.handleUpgrade(req, socket, head, callback)` consumes the HTTP upgrade request. The `ws` library validates the WebSocket headers, computes the `Sec-WebSocket-Accept` response, writes the `101 Switching Protocols` response, and takes ownership of the socket.
7. The callback emits `connection`, which runs the connection setup handler.
8. The connection handler initializes heartbeat state and a subscription set, then sends `{ "type": "welcome" }` as the first application message.
9. From this point on, communication uses WebSocket frames rather than HTTP request/response cycles. The client sends JSON commands and receives JSON events until it closes or is terminated.

The `101 Switching Protocols` response is the boundary between HTTP and WebSocket. A frontend should not call `fetch('/ws')`; it should construct a `WebSocket` with the `ws://` or `wss://` URL.

## 8. WebSocket client protocol

### Connection setup

```js
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ type: 'subscribe', matchId: 1 }));
});
```

The browser should wait for the `open` event before sending commands. The server sends `welcome` immediately after the connection is established.

### Subscribe

Client sends:

```json
{"type":"subscribe","matchId":1}
```

The match ID must be an integer. The server adds the socket to the match's subscriber set and replies only to that socket:

```json
{"type":"subscribed","matchId":1}
```

A socket may subscribe to up to 100 distinct matches. Re-subscribing to an existing match is idempotent and does not consume another slot.

### Unsubscribe

Client sends:

```json
{"type":"unsubscribe","matchId":1}
```

The server removes the socket from that match and replies:

```json
{"type":"unsubscribed","matchId":1}
```

### Server events

- `welcome`: connection is ready.
- `subscribed`: subscription accepted.
- `unsubscribed`: subscription removed.
- `match_created`: sent to every connected client after `POST /matches` succeeds. Payload is the created match in `data`.
- `commentary`: sent only to sockets subscribed to the event's `matchId`. Payload is the inserted commentary row in `data`.
- `score_update`: sent only to sockets subscribed to the match. Payload contains `homeScore` and `awayScore` in `data`.
- `error`: malformed JSON, subscription-limit violations, or message-rate violations.

Example event handling:

```js
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  switch (message.type) {
    case 'welcome':
    case 'subscribed':
    case 'unsubscribed':
      break;
    case 'commentary':
      renderCommentary(message.data);
      break;
    case 'score_update':
      updateScore(message.data);
      break;
    case 'match_created':
      addMatch(message.data);
      break;
    case 'error':
      showConnectionError(message.message);
      break;
  }
});
```

## 9. WebSocket fan-out and cleanup

The server stores subscriptions in a `Map`:

```text
matchId -> Set<WebSocket>
```

`broadcastToMatch` serializes an event once and sends it to every socket in that match's set. `broadcastToAll` iterates over `wss.clients` for global events such as `match_created`.

Each socket also owns `socket.subscriptions`, a `Set` of match IDs. When the socket closes, `cleanupSubscriptions` removes it from every match set. Empty match sets are deleted to avoid retaining unused memory.

All outgoing messages pass through one send path. Closed sockets are ignored. If `bufferedAmount` exceeds 1 MiB, the socket is terminated instead of silently dropping required live updates. A frontend should reconnect and reload current REST state after such a disconnect.

## 10. Heartbeats and limits

Every 30 seconds the server pings every client:

1. If `isAlive` was already false, the connection is terminated.
2. Otherwise, `isAlive` is set false and a ping is sent.
3. A valid pong sets `isAlive` true.

This detects dead mobile networks, half-open TCP connections, and clients that disappeared without a clean close.

The `ws` server accepts payloads up to 1 MiB. Each connection is limited to 30 inbound messages per one-second window. Exceeding that limit sends an error and terminates the connection. The client should treat termination as a signal to reconnect with backoff.

## 11. Seed fixtures and seed behavior

Fixtures are now deliberately separated:

- `src/data/matches.json` contains `{ "matches": [...] }`.
- `src/data/commentaries.json` contains `{ "commentary": [...] }`.

The old `src/data/data.json` file was removed. The files include the original fixtures plus additional dummy matches and commentary events. Commentary `matchId` values refer to fixture match IDs.

`src/seed/seed.js` reads both JSON files independently, validates that both arrays exist, and then:

1. Fetches existing matches from `GET /matches`.
2. Creates missing fixture matches through `POST /matches`, matching on sport and team names.
3. Maps fixture IDs to actual database IDs.
4. Expands commentary templates across same-sport matches when a match has no direct fixture commentary.
5. Normalizes cricket innings ordering.
6. Randomizes the feed while trying not to emit two consecutive events for the same match.
7. Inserts each event through `POST /matches/:id/commentary`.
8. Waits `DELAY_MS` between events so connected frontend clients can observe live broadcasts.

`MATCH_COUNT=0` uses all match fixtures. A positive `MATCH_COUNT` limits match creation/selection to the first N match fixtures. `API_URL`, `SEED_CLIENT_HOST`, `SEED_CLIENT_PORT`, `SEED_MATCH_DURATION_MINUTES`, and `SEED_FORCE_LIVE` influence the seed process. Seed data is inserted through the public API rather than directly through Drizzle, so the same validation and WebSocket broadcasts are exercised as production traffic.

## 12. Recommended frontend lifecycle

A frontend should combine an initial REST snapshot with WebSocket updates:

1. Fetch `/matches` to render the initial list.
2. Fetch `/matches/:id/commentary` when a match detail view opens.
3. Open one shared WebSocket connection where possible.
4. Subscribe to visible/live match IDs after `open`.
5. Apply `commentary` and `score_update` events immediately to local UI state.
6. Apply `match_created` to the match list.
7. On `close` or `error`, reconnect with exponential backoff and jitter.
8. After reconnecting, refetch REST data because events may have occurred while disconnected.
9. Unsubscribe from matches no longer visible to keep the socket under its 100-match limit.

The REST API is the source for resynchronization; the WebSocket is the low-latency update channel. Do not assume a WebSocket connection alone contains historical commentary or that every event can be replayed after a disconnect.

## 13. Security and operational behavior

The HTTP layer sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Frame-Options: SAMEORIGIN`. Express JSON parsing is capped at 256 KB. Arcjet can protect HTTP requests and WebSocket upgrades; in production, configure `ARCJET_KEY` and use live protection. The service separates liveness (`/health`) from database readiness (`/ready`).

The application uses parameterized Drizzle queries and Zod validation. The database foreign key ensures commentary cannot refer to a missing match, and cascading deletes remove dependent commentary when a match is deleted. Secrets such as `DATABASE_URL` and `ARCJET_KEY` must be supplied through environment configuration and must not be committed.

## 14. Important frontend assumptions

- IDs are numbers, not strings, in the wire protocol.
- Event `data` is the useful payload for all broadcast events.
- Commentary list REST results are newest-first, while the seed process emits events over time.
- A score update is accepted only while the match is live according to the backend time window.
- The backend currently broadcasts commentary and score changes; it does not automatically broadcast a status-change event when time moves from scheduled to live or live to finished.
- WebSocket authentication is not implemented in this repository, so any deployment that requires private match feeds should add an authentication/authorization check inside the upgrade handler before `handleUpgrade`.
- A reverse proxy must forward WebSocket upgrade headers and preserve the `/ws` path.

## 15. End-to-end example

```text
Frontend                  Backend HTTP                    Database / WebSocket
   |                            |                                  |
   | GET /matches ------------> | ---- SELECT matches ----------> |
   | <----------- data -------- | <------------- rows ------------ |
   |                            |                                  |
   | WebSocket /ws ------------>|                                  |
   | <-------- 101 upgrade ---- |                                  |
   | <--------- welcome ------- |                                  |
   | subscribe match 1 ------> |                                  |
   | <------- subscribed ------ |                                  |
   |                            |                                  |
   | POST commentary ---------> | ---- INSERT commentary --------> |
   |                            | <------------- row --------------|
   | <------- commentary ------ |                                  |
   |                            |                                  |
   | PATCH score -------------> | ---- UPDATE live match --------> |
   |                            | <------------ updated ------------|
   | <------ score_update ----- |                                  |
```

The essential architecture is therefore: Express handles commands and snapshots, PostgreSQL persists durable state, and the WebSocket server distributes successful mutations to interested clients in real time.

## 16. Files to start from when building the frontend

- `src/routes/matches.js`: match list/create/score API behavior.
- `src/routes/commentary.js`: commentary list/create API behavior.
- `src/ws/server.js`: connection, subscription, event, heartbeat, and reconnect semantics.
- `src/db/schema.js`: exact persisted field names and nullable fields.
- `src/validation/*.js`: exact accepted request shapes.
- `src/data/matches.json` and `src/data/commentaries.json`: fixture shape and sample values.
- `README.md`: concise setup and endpoint reference.

Use this context together with the live API responses: database-generated IDs and timestamps can differ from fixture IDs and timestamps after seeding.

---

Generated for the Sportz Live Sports Backend repository.
