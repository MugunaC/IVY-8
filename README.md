# IVY App (UI + API + WebSocket)

Developer-facing documentation for the IVY web app, API, WebSocket servers, and gateway. This repo is the refactored `8` line derived from `../7` with cleaner server primitives, server-backed search, slimmer browser storage responsibilities, and expanded regression coverage.

**Table of Contents**
1. Architecture Overview
2. Process Model
3. Repo Layout
4. Environment Configuration
5. Local Development
6. Refactor Notes
7. Remote Access (Single-Tunnel)
8. WebSocket Protocol Notes
9. Protocol Schemas
10. Device Authentication Flow
11. Gateway Internals
12. Deployment Hardening
13. Persistence Model
14. Metrics & Health
15. Tests & Load
16. Troubleshooting

## Architecture Overview
The system is composed of three always-on services plus a gateway:
- **API**: HTTP REST endpoints (users, vehicles, missions, telemetry ingestion).
- **WS Control**: operator control channel.
- **WS Telemetry**: telemetry ingestion from UI or automation.
- **WS Device**: edge device channel (Pico W).
- **Gateway**: single public entry point that proxies UI + API + WS for remote access.

The gateway is the only component exposed to the internet when using Cloudflare quick tunnels.

## Process Model
Single-machine local dev typically runs these processes:
1. `dev:server` -> API + all WS servers
2. `dev:client` or `dev:client:remote` -> React UI
3. `dev:gateway` or `dev:gateway:proxy` -> gateway HTTP + WS proxy
4. `cloudflared tunnel --url http://127.0.0.1:5000`

## Repo Layout
- `src/` UI (React + Tailwind)
- `shared/` shared types and WS protocol helpers
- `server/` API + WS server + gateway
- `server/lib/` shared server primitives extracted from the composition root
- `server/data/` runtime persistence, including SQLite and retained legacy sidecars
- `public/` UI assets
- `docs/implementation-backlog.md` phased refactor backlog used for the `8` execution

## Refactor Notes
- Shared server concerns now live under `server/lib/` and environment parsing is centralized in `server/config.ts`.
- Password hashing now uses a forward-compatible format while preserving legacy hash verification.
- Admin search now uses a server-backed `/api/search` flow instead of loading full datasets into the browser first.
- Browser storage is reduced to preferences and ephemeral client state; server-owned entities are no longer seeded locally.
- Shared realtime helpers now live in dedicated files such as `missionUtils.ts` and `GoogleMapsLocationIcon.tsx`.

## Environment Configuration
Key server env vars (all optional):
- `WS_HOST` (default `0.0.0.0`)
- `WS_CONTROL_PORT` (default `3000`)
- `WS_TELEMETRY_PORT` (default `3001`)
- `WS_DEVICE_PORT` (default `4000`)
- `API_PORT` (default `3100`)
- `DEVICE_SHARED_SECRET` (default `ivy-dev-device-secret`)
- `DEVICE_AUTH_WINDOW_MS` (default `30000`)
- `DEVICE_HEARTBEAT_TIMEOUT_MS` (default `5000`)
- `DEVICE_HEARTBEAT_SCAN_MS` (default `1000`)
- `CONTROL_RATE_LIMIT_PER_SEC` (default `30`)
- `CONTROL_RATE_BURST` (default `2`)
- `DEVICE_REGISTRY_JSON` (override registry)

UI env files:
- `.env` / `.env.local` for local dev
- `.env.remote` for same-origin remote mode (empty API/WS overrides)

## Local Development
Install dependencies:
```bash
npm install
```

Start backend (API + WS):
```bash
npm run dev:server
```

Start UI:
```bash
npm run dev:client
```

Optional: API or WS only
```bash
npm run dev:api
npm run dev:ws
```

## Remote Access (Single-Tunnel)
Remote flow is intentionally **single-tunnel**. One URL proxies UI + API + WS.

One command:
```bash
npm run dev:remote:one
```

Manual equivalent:
```bash
npm run dev:server
npm run dev:client:remote
npm run dev:gateway:proxy
cloudflared tunnel --url http://127.0.0.1:5000
```

### Gateway Routing
Gateway forwards:
- `/api/*` -> API (`http://127.0.0.1:3100`)
- `/ws/control` -> WS control (`ws://127.0.0.1:3000`)
- `/ws/telemetry` -> WS telemetry (`ws://127.0.0.1:3001`)
- `/ws/device` -> WS device (`ws://127.0.0.1:4000`)

## WebSocket Protocol Notes
Device WS (`/ws/device`) accepts:
- `device_hello` (auth bootstrap)
- `hello` (heartbeat)
- `sensor_state`
- `location`
- `control` (device ? server only for echo/testing)

Server sends:
- `auth_ok`
- `auth_error`
- `error`
- `control` (downlink to device)
- `camera_control`

Control WS (`/ws/control`) accepts:
- `hello`
- `location_subscribe`
- `input` / `control` / `camera_control`

### Active Control Publisher
When multiple IVY control or focus tabs are open for the same vehicle in the same browser session, the browser elects a single active control publisher per vehicle. The active, focused visible tab silently takes ownership and is the only tab that emits gamepad-driven `input`, `control`, and gamepad-triggered mission/mode actions. This is client-side arbitration only:
- it does not change the JSON schema sent to the backend or device
- it is intended to prevent duplicate 20 Hz manual control streams from sibling tabs
- takeover is automatic on focus/visibility changes and on tab close/logout

Telemetry WS (`/ws/telemetry`) accepts:
- `hello`
- `input` (telemetry payload)

## Protocol Schemas
Minimal JSON examples used by the server. These are not full schemas, but match current parsing logic.

Device hello (device -> server):
```json
{
  "type": "device_hello",
  "payload": {
    "vehicleId": "VH-001",
    "deviceId": "PICO-VH-001",
    "ts": 1775038870782,
    "nonce": "pico-nonce-1775038870782",
    "sig": "<hex-hmac>",
    "fw": "pico-w-1.0.0",
    "caps": ["control", "sensor_state", "location"]
  }
}
```

Auth ok (server -> device):
```json
{
  "type": "auth_ok",
  "vehicleId": "VH-001",
  "deviceId": "PICO-VH-001",
  "ts": 1775038870782
}
```

Heartbeat (device -> server):
```json
{ "type": "hello" }
```

Telemetry (device -> server):
```json
{
  "type": "sensor_state",
  "vehicleId": "VH-001",
  "payload": {
    "ts": 1775038870782,
    "vehicleId": "VH-001",
    "batteryMv": 12050,
    "currentMa": 3200,
    "socPct": 74.2,
    "motorTempC": 38.5,
    "escTempC": 42.1,
    "faults": 0
  }
}
```

Control (server -> device):
```json
{
  "type": "control",
  "vehicleId": "VH-001",
  "payload": {
    "seq": 123,
    "leaseId": "lease-abc123",
    "buttons": [0, 1, 0, 0],
    "axes": [0.12, -0.4, 0.0, 0.0],
    "mode": "manual"
  }
}
```

## Device Authentication Flow
Auth is HMAC-SHA256 over:
```
vehicleId|deviceId|ts|nonce
```

Server-side check (in `server/index.ts`):
- vehicle exists
- deviceId matches
- `ts` within `DEVICE_AUTH_WINDOW_MS`
- nonce not reused
- signature matches

Device registry default:
- `deviceId = PICO-<vehicleId>`
- `secret = DEVICE_SHARED_SECRET`

Override with `DEVICE_REGISTRY_JSON`:
```json
[
  {"vehicleId": "VH-001", "deviceId": "PICO-VH-001", "secret": "my-secret"}
]
```

## Gateway Internals
The gateway is a single HTTP server with WS upgrade handling. It does three things:
- Serves static UI (or proxies Vite when `GATEWAY_PROXY_UI=1`)
- Proxies `/api` to the backend API
- Upgrades `/ws/*` and proxies to the backend WS ports

Key routing logic (in `server/gateway.ts`):
```ts
function resolveWsTarget(pathname: string) {
  if (pathname.startsWith('/ws/control')) return `ws://${WS_HOST}:${WS_CONTROL_PORT}${pathname}`;
  if (pathname.startsWith('/ws/telemetry')) return `ws://${WS_HOST}:${WS_TELEMETRY_PORT}${pathname}`;
  if (pathname.startsWith('/ws/device')) return `ws://${WS_HOST}:${WS_DEVICE_PORT}${pathname}`;
  return null;
}
```

### WS Frame Type Preservation
The gateway must preserve WS frame type to avoid Pico W ignoring server messages.

Current behavior (required):
```ts
client.on('message', (data, isBinary) => {
  if (upstream.readyState === WebSocket.OPEN) {
    upstream.send(data, { binary: isBinary });
  }
});

upstream.on('message', (data, isBinary) => {
  if (client.readyState === WebSocket.OPEN) {
    client.send(data, { binary: isBinary });
  }
});
```

### WS Compression
The gateway disables permessage-deflate to prevent unexpected binary framing or compression artifacts:
```ts
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
```

## Deployment Hardening
Recommended changes for production or long-lived deployments:
- Use a **named Cloudflare tunnel** with a DNS hostname instead of quick tunnels.
- Set `DEVICE_SHARED_SECRET` to a strong unique value and avoid defaults.
- Provide `DEVICE_REGISTRY_JSON` for explicit device allowlists.
- Enable TLS verification on device by supplying a CA bundle (avoid `tlsAllowInsecure`).
- Restrict inbound ports to `5000` only (gateway) and keep backend ports bound to localhost.
- Store logs in a writable directory for cloudflared (`--logfile`), avoid `C:\\Users\\DELL` permission issues.
- Consider rate limiting at the gateway layer for `/api` and `/ws/*`.

## Persistence Model
Data lives in `server/data/`:
- `ivy.db` / `ivy.db-wal` / `ivy.db-shm` are the active SQLite persistence layer
- `db.json` is retained as a legacy sidecar
- `telemetry.json` and `input.json` are retained legacy/high-volume sidecars pending deeper telemetry cleanup
- `telemetry-archive/` contains archived telemetry snapshots
- `coop_messages` are persisted in SQLite with a strict 10 MB cap; oldest rows are evicted first and the UI loads the latest 50 messages per session

Telemetry limits:
- `MAX_TELEMETRY` (default `50000`)

## Metrics & Health
- Health: `GET /health`
- Metrics: `GET /metrics`

## Tests & Load
```bash
npm run build:ws
npm run typecheck
npm run test
npm run lint
```

Current refactor verification:
- `npm run build:ws`
- `npm run typecheck`
- `npm run test`
- `npm run lint` -> use current output rather than this README for exact warning count

Load tests:
```bash
k6 run tests/load/telemetry-ws.js
k6 run tests/load/api.js
```

## Troubleshooting
### Device connects, sends `device_hello`, never authenticates
Cause: gateway forwarded text frames as binary.
Fix: preserve `isBinary` in `server/gateway.ts`.

### Auth errors about timestamp/nonce
- Ensure SNTP sync is correct on device.
- Ensure nonce is unique per connection.

### Invalid credentials in UI
- Confirm user exists in `server/data/db.json` or register via UI.

### Cloudflared binary
`cloudflared.exe` is not tracked in git. Install locally from Cloudflare releases.
