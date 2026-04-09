# IVY Greenfield Blueprint

Date: 2026-03-01  
Scope: Rebuild IVY for responsive UX, low-latency control, and operational safety.

## 1) Product and Performance Targets

### Core goals
- Responsiveness on desktop and mobile for operator workflows.
- Low-latency control/data paths for telemetry, control, map, and video.
- Easy-to-use operator and admin flows with clear safety states.

### SLOs (first release)
- Input-to-control-gateway acknowledge: p95 < 60 ms.
- Location update to map paint: p95 < 120 ms.
- Video first frame after join: p95 < 1.5 s.
- App first interactive render on mid-tier mobile: p95 < 2.5 s.
- Control-plane availability: 99.9% monthly.

## 2) What We Adopt From ArduPilot and Alset

## 2.1 ArduPilot patterns to adopt
Observed in:
- `C:\Users\DELL XPS 9360\Documents\Github Repositories\ardupilot\Rover\Rover.cpp`
- `C:\Users\DELL XPS 9360\Documents\Github Repositories\ardupilot\Rover\failsafe.cpp`
- `C:\Users\DELL XPS 9360\Documents\Github Repositories\ardupilot\Rover\mode.h`
- `C:\Users\DELL XPS 9360\Documents\Github Repositories\ardupilot\libraries\AP_Scheduler\AP_Scheduler.cpp`
- `C:\Users\DELL XPS 9360\Documents\Github Repositories\ardupilot\libraries\AP_Param\AP_Param.cpp`
- `C:\Users\DELL XPS 9360\Documents\Github Repositories\ardupilot\libraries\AP_Logger\AP_Logger.cpp`

Adopt:
- Deterministic task scheduling with explicit rates, priorities, and time budgets.
- Formal mode/state architecture with guarded `enter/exit` semantics.
- Layered failsafe policies with timeout, trigger source, and action escalation.
- Tunable parameter registry with safe defaults and metadata.
- Multi-backend logging with rate caps, buffering, and retention controls.
- Arming/health checks before enabling autonomous or remote-control actions.

## 2.2 Alset patterns to adopt
Observed in:
- `C:\Users\DELL XPS 9360\Documents\Github Repositories\alset\arduino\esp32_thing\main.cpp`
- `C:\Users\DELL XPS 9360\Documents\Github Repositories\alset\arduino\micro_32u4\main.cpp`
- `C:\Users\DELL XPS 9360\Documents\Github Repositories\alset\README.md`

Adopt:
- Start in safe state by default; explicit kill switch behavior at all times.
- Input freshness timeout (stale command failsafe) at edge/controller level.
- Assisted mode split: operator throttle + autonomy steering option.
- Controller haptics/visual feedback linked to obstacle or risk proximity.
- Hardware and software modularity through clear comms hub boundaries.

Do not adopt:
- Unauthenticated/simple control APIs from old demo code.
- Ad hoc one-off networking without retries, auth, or observability.

## 3) Target Monorepo Structure

```text
ivy/
  apps/
    web-ops/                 # React operator/admin web app
    api/                     # REST API (auth, users, vehicles, admin)
    control-gateway/         # Low-latency WS control + location stream
    media-signaling/         # WebRTC signaling + room/session control
    telemetry-writer/        # Async ingest -> storage pipeline
  packages/
    domain/                  # Shared domain models + enums + errors
    protocol/                # Binary/JSON control protocol + schemas
    state-contracts/         # Query keys, events, DTO contracts
    ui-kit/                  # Shared UI primitives + tokens
    telemetry-codec/         # Binary delta encode/decode + tests
    config/                  # Runtime config schema + env validation
  infra/
    docker/
    k8s/
    observability/           # dashboards, alerts, traces
  docs/
    adr/                     # architecture decisions
    runbooks/                # incident and ops procedures
```

## 4) Service Boundaries

### `api`
- Responsibilities:
  - Auth/session, RBAC, users, vehicles, assignments, audit query.
  - Admin search/filter endpoints with pagination.
- Storage:
  - PostgreSQL (OLTP).
  - Redis for session/cache.

### `control-gateway`
- Responsibilities:
  - Bidirectional control channel (WS), location fanout, device heartbeats.
  - Control lease per vehicle (single active operator), sequence checks, replay protection.
  - Deterministic dispatch loop with priority queues.
- Storage:
  - Redis for ephemeral lease/session state.
  - No sync disk writes on hot path.

### `telemetry-writer`
- Responsibilities:
  - Consume telemetry from queue (Kafka/NATS/Redis stream), batch write.
  - Downsample pipelines and retention policies.
- Storage:
  - Timeseries store (TimescaleDB/ClickHouse) + object storage for exports.

### `media-signaling`
- Responsibilities:
  - Viewer/device authentication, room control, ICE/signaling.
  - Stream health metrics and degrade signals.

### Edge device bridge
- Responsibilities:
  - Convert cloud protocol to device-native bus.
  - Enforce stale-command timeout and failsafe action locally.
  - Emit signed heartbeat and health.

## 5) State Model

### 5.1 Server-authoritative state
- `SessionState`: user identity, roles, auth context.
- `VehicleLeaseState`: vehicle lock, operator, ttl, mode.
- `ControlSessionState`: finite state machine:
  - `idle -> reserving -> reserved -> arming -> live -> degraded -> failsafe -> ended`
- `DeviceLinkState`: online, heartbeat age, quality, last seq.
- `SafetyState`: estop, fence breach, battery critical, link-loss.

### 5.2 Client state (web)
- `authSlice`: current user/session.
- `uiSlice`: layout, active panels, focus mode.
- `controlSlice`: operator inputs, selected mode, local predicted state.
- `realtimeSlice`: ws health, stream health, latency stats.
- `telemetrySlice`: rolling buffer for charts/indicators (not source of truth).

Rules:
- Control truth is gateway/edge, not browser.
- Browser keeps small ring buffers and view state only.
- Any safety-critical transition originates from server or edge.

## 6) Protocol and Control Model

### Control message contract
- Mandatory fields:
  - `vehicleId`, `sessionId`, `seq`, `ts`, `input`, `mode`, `estop`.
- Validation:
  - monotonic `seq` per control lease.
  - max jump window + replay rejection.
  - mode capability check before apply.
- Transport:
  - Binary delta packets at fixed cadence for control.
  - JSON side-channel for diagnostics/events.

### Failsafe hierarchy
1. Edge stale-input timeout (hard stop).
2. Gateway heartbeat timeout (lease revoke + force hold/stop).
3. Vehicle policy action ladder (`hold -> rtl -> terminate/disarm`) by severity.

## 7) UX and Responsiveness Blueprint

### Operator UX
- Mobile-first responsive shell:
  - persistent primary control strip.
  - map/video as dockable modules.
  - one-tap E-Stop always visible.
- Progressive disclosure:
  - compact mode by default.
  - diagnostics in secondary drawer/tabs.

### Performance tactics
- Route-level and panel-level code splitting.
- Worker-based parsing for heavy telemetry transforms.
- Virtualized tables in admin and logs.
- Server-driven search/filter/paginate.
- Render throttling for non-critical panes.

## 8) Security and Safety Baseline

- Session auth with short-lived access + refresh rotation.
- RBAC + policy checks at API and gateway.
- Signed device hello + nonce + time window.
- Per-vehicle control lease and ownership checks.
- Immutable audit trail for safety actions and mode changes.

## 9) Observability and Operations

- Metrics:
  - input->ack latency, ws reconnect rate, dropped packet rate, heartbeat age.
- Tracing:
  - request traces across web -> api -> gateway -> edge bridge.
- Logging:
  - structured logs with correlation IDs.
- Alerts:
  - lease churn anomalies, high failsafe rate, stream quality degradation.

## 10) Implementation Sequence (12 Weeks)

## Phase 0 (Week 1): Foundations
- Create monorepo skeleton, shared packages, ADR template.
- Add config validation and environment profiles.
- Define SLO dashboards and baseline telemetry.
- Exit criteria:
  - CI green with typecheck, tests, lint, build for all apps.

## Phase 1 (Weeks 2-3): Auth + API + Data
- Implement session auth (cookie/JWT), RBAC middleware.
- Move users/vehicles/logs to PostgreSQL.
- Build paginated search/filter API endpoints.
- Exit criteria:
  - all admin/user CRUD behind auth and role policy.

## Phase 2 (Weeks 3-5): Control Gateway v1
- Implement control lease model and FSM.
- Add seq/replay checks, rate limits, heartbeat tracking.
- Add deterministic control dispatch loop with budgets.
- Exit criteria:
  - one active operator per vehicle, stale-input failsafe working.

## Phase 3 (Weeks 5-6): Edge Bridge + Safety
- Implement edge bridge protocol adapter.
- Add local stale-input hard-stop and safety action ladder.
- Add signed device hello and periodic attestation heartbeat.
- Exit criteria:
  - controlled failover on link loss with audited transitions.

## Phase 4 (Weeks 6-8): Web Ops UI v1
- Build responsive operator shell and safety-first control panel.
- Add map/video/control modules with adaptive layouts.
- Add haptics/risk feedback wiring where supported.
- Exit criteria:
  - desktop and mobile operator flows usable without debug UI.

## Phase 5 (Weeks 8-9): Telemetry Pipeline
- Introduce queue-backed telemetry ingestion.
- Batch writer, retention policy, downsampling jobs.
- Build telemetry query/export endpoints.
- Exit criteria:
  - no sync writes in control hot path, stable under load tests.

## Phase 6 (Weeks 9-10): Media Signaling + Stream Health
- Separate media signaling service.
- Add stream quality indicators + retry/degrade policy.
- Exit criteria:
  - video/session health surfaced in operator UI.

## Phase 7 (Weeks 10-11): Hardening + Testing
- Property and fuzz tests for protocol/sequence validation.
- Chaos tests for disconnects, delayed packets, and partial outages.
- Security tests for authz and replay/nonce.
- Exit criteria:
  - regression suite covers safety-critical paths.

## Phase 8 (Week 12): Cutover
- Staged rollout with shadow traffic.
- Runbooks and on-call alerts validated.
- Decommission legacy endpoints.
- Exit criteria:
  - SLOs met for two consecutive weeks.

## 11) First Build Slice (Recommended)

Ship a minimal but safe vertical slice first:
1. Auth + vehicle assignment + control lease.
2. Control gateway with heartbeat and stale-input failsafe.
3. Operator UI with E-Stop, mode selector, and basic telemetry.
4. Audit log for all safety and mode transitions.

This slice gives immediate safety and latency wins before richer map/video/admin expansions.

