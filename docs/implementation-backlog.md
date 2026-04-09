# IVY Implementation Backlog

This backlog turns the optimization review into an execution sequence for the `8` repo. It is organized as phased PRs so the work can be reviewed, tested, and compared against `7`.

## Goals

- Reduce maintenance risk in oversized files.
- Remove split-brain state between browser storage and server persistence.
- Improve scalability of admin/search flows as records grow.
- Isolate realtime logic so controller and focus-map changes are cheaper.
- Increase test coverage around high-risk server and control behavior.

## Baseline Hotspots

- `server/index.ts`
- `src/app/pages/ControllerPage.tsx`
- `src/app/components/realtime/FocusMapView.tsx`
- `src/app/data/storage.ts`
- `src/app/components/admin/SearchTab.tsx`
- `src/app/components/admin/UsersTab.tsx`
- `src/app/components/admin/VehiclesTab.tsx`
- `src/app/components/admin/LogsTab.tsx`
- `src/app/components/admin/TelemetryTab.tsx`

## Phased PR Sequence

### PR 1: Server Foundations

Scope:
- Extract shared server concerns from `server/index.ts`.
- Centralize configuration, structured logging, body parsing, and password hashing.
- Keep runtime behavior stable while reducing surface area in the composition root.

Target files:
- `server/index.ts`
- `server/db.ts`
- `server/config.ts`
- `server/lib/auth.ts`
- `server/lib/http.ts`
- `server/lib/logging.ts`
- `server/lib/metrics.ts`
- `server/lib/rateLimit.ts`

Tasks:
- Move env parsing/constants into `server/config.ts`.
- Move password hashing and verification into `server/lib/auth.ts`.
- Support a forward-compatible password format with embedded metadata.
- Move request-body parsing helpers into `server/lib/http.ts`.
- Move structured logging and Prometheus formatting helpers into dedicated modules.
- Move token bucket/rate-limit helpers into `server/lib/rateLimit.ts`.
- Update `server/db.ts` to consume the shared auth helpers instead of duplicating hashing logic.

Acceptance:
- `server/index.ts` shrinks materially.
- User login and registration still work.
- Existing server tests continue to pass.

### PR 2: Search and Admin Scalability

Scope:
- Stop loading full users/vehicles/logs collections into the client for simple search.
- Add server-backed query endpoints with limits.

Target files:
- `server/index.ts`
- `server/db.ts`
- `src/app/data/apiClient.ts`
- `src/app/components/admin/SearchTab.tsx`
- `src/app/components/admin/UsersTab.tsx`
- `src/app/components/admin/VehiclesTab.tsx`
- `src/app/components/admin/LogsTab.tsx`
- `shared/types.ts`

Tasks:
- Add queryable API endpoints for users, vehicles, and logs.
- Support `q`, `limit`, and resource-specific filters.
- Replace `SearchTab` client-side fetch-and-filter with server-backed search.
- Reuse the same endpoint patterns for later pagination of admin tables.

Acceptance:
- Search behavior remains functionally equivalent.
- Network payloads for search are bounded.
- Search no longer needs entire datasets loaded into browser memory.

### PR 3: Client State Simplification

Scope:
- Reduce browser-local storage to UI/session preferences only.
- Remove local seeding of server-owned domain entities.

Target files:
- `src/app/data/storage.ts`
- `src/app/data/settingsRepo.ts`
- `src/app/context/AuthContext.tsx`
- `src/app/pages/UserPage.tsx`
- `src/app/pages/ControllerPage.tsx`
- `src/app/components/realtime/MapPanel.tsx`

Tasks:
- Remove default user/vehicle/log domain seeding from local storage.
- Keep only theme, last-selected vehicle, map preferences, and ephemeral UI flags in local storage.
- Clarify persistence boundaries in comments and helper names.
- Audit repo modules so server-owned entities always come from API/WS, not seeded browser defaults.

Acceptance:
- App boot still works without any seeded browser data.
- Storage helpers become smaller and easier to reason about.
- Auth/session behavior remains unchanged.

### PR 4: Realtime Surface Decomposition

Scope:
- Extract shared controller/focus-map logic into smaller hooks/components.
- Reduce page-level complexity without changing primary behavior.

Target files:
- `src/app/pages/ControllerPage.tsx`
- `src/app/components/realtime/FocusMapView.tsx`
- `src/app/components/realtime/control/*`
- `src/app/components/realtime/focus-map/*`
- `src/app/hooks/realtime/*`

Tasks:
- Extract overlay/menu components from `ControllerPage`.
- Extract controller header/quick-actions into dedicated components.
- Extract mission overlay/selection logic from both controller and focus-map surfaces.
- Move repeated telemetry/control socket plumbing behind hooks where possible.
- Consolidate shared mission summary/formatting helpers.

Acceptance:
- `ControllerPage.tsx` and `FocusMapView.tsx` both shrink meaningfully.
- Shared logic has one home instead of being duplicated.
- No visible regressions in control, map, or co-op behavior.

### PR 5: Telemetry and Persistence Cleanup

Scope:
- Clarify the canonical persistence path for telemetry and input records.
- Make retention and archival behavior more explicit and testable.

Target files:
- `server/db.ts`
- `server/index.ts`
- `server/lib/telemetry.ts`
- `tests/*`

Tasks:
- Move telemetry queue/flush/prune helpers out of `server/index.ts`.
- Reduce direct JSON sidecar dependence in favor of SQLite + archive policy.
- Add focused tests for retention/pruning boundaries.
- Document retention expectations in `README.md`.

Acceptance:
- Telemetry flow is easier to follow.
- Retention behavior is covered by tests.
- Operational behavior is documented.

### PR 6: Confidence and Regression Coverage

Scope:
- Add tests around high-risk paths that currently lack coverage.

Target files:
- `tests/server-auth.spec.ts`
- `tests/server-search.spec.ts`
- `tests/storage.spec.ts`
- `tests/protocol.spec.ts`
- `tests/server-rate-limit.spec.ts`

Tasks:
- Add tests for password hashing/verification compatibility.
- Add tests for server-backed search filtering/limits.
- Add tests for rate limiting helpers.
- Extend storage tests to verify removal of seeded domain state.

Acceptance:
- Test suite meaningfully covers the refactor seams.
- `npm run typecheck`, `npm run test`, and `npm run lint` pass.

## Execution Order

1. PR 1
2. PR 2
3. PR 3
4. PR 4
5. PR 5
6. PR 6

## Comparison Metrics to Gather After Completion

- Lines in `server/index.ts`
- Lines in `src/app/pages/ControllerPage.tsx`
- Lines in `src/app/components/realtime/FocusMapView.tsx`
- Number of server helper modules extracted
- Number of client search flows moved server-side
- Test count before vs after
- Full verification results:
  - `npm run typecheck`
  - `npm run test`
  - `npm run lint`
