# IVY Refactor Plan (Concrete)
Date: 2026-02-11
Baseline: IVY/4 codebase (Vite + React + Tailwind + ws server)

## Goals
- Reduce dependency weight and ambiguity.
- Create a single source of truth for domain types.
- Separate UI, data access, and telemetry responsibilities.
- Improve protocol safety and test coverage.

## Non-Goals (this pass)
- Replace React or Vite.
- Build a full backend auth or persistent DB.

## Phase 0 — Dependency Audit (start here)
Outputs
- docs/deps-audit.md
- Updated package.json and package-lock.json

Steps
- Create an inventory of direct dependencies from package.json and npm ls --depth=0.
- Scan imports with rg to map each dependency to actual usage.
- Verify which UI components are actually imported by app pages.
- Remove unused dependencies and update the lockfile.
- Run npm run dev and npm run build to confirm.

Suggested commands
```powershell
npm ls --depth=0
rg -n "@/app/components/ui/" src\app -g"*.tsx"
rg -n "from '" src -g"*.ts" -g"*.tsx"
```

Quick scan notes (needs confirmation)
- No @mui/* imports in src; if true remove @mui/material, @mui/icons-material, @emotion/*, @popperjs/core, react-popper.
- No react-dnd imports in src.
- No react-slick imports in src.
- No motion imports in src (only class names contain "motion").
- recharts, embla-carousel-react, input-otp, cmdk appear only inside unused UI components.
- Only UI components imported in app code: alert, badge, button, card, checkbox, dialog, input, label, select, sonner, table, tabs.

Acceptance
- deps-audit lists keep or remove rationale for every dependency.
- npm run dev and npm run build succeed after pruning.

## Phase 1 — Shared Type Layer
Outputs
- src/shared/types/*.ts
- App code uses shared types
- Server uses the same types via TS or JSDoc

Steps
- Create src/shared/types with User, Vehicle, ActivityLog, TelemetryPayload, TelemetryEntry, RecordEntry, WsMessage.
- Update app files to import shared types:
  - src/app/context/AuthContext.tsx
  - src/app/pages/UserPage.tsx
  - src/app/components/admin/*.tsx
  - src/app/lib/telemetryStore.ts
- Align Vehicle type across admin and user pages with optional fields for currentUser/currentUserId.
- Decide server typing approach:
  - Option A: Convert server.js to TypeScript with tsconfig.server.json and a build step.
  - Option B: Keep server.js and add // @ts-check with JSDoc typedefs from src/shared/types.

Acceptance
- No duplicated type definitions across app files.
- Type checking passes (tsc or Vite build).
- Server and client agree on telemetry payload shape.

## Phase 2 — Data Access Layer (local-only)
Outputs
- src/app/data/*.ts
- Components no longer touch localStorage or IndexedDB directly

Steps
- Create repositories for users, vehicles, logs, telemetry, and settings.
- Consolidate storage keys and defaults in one module.
- Provide seed and migration helpers for default data.

Acceptance
- Pages read and write through the data layer.
- Behavior matches existing UI.

## Phase 3 — Telemetry Protocol + Validation
Outputs
- Runtime validation and versioned WS message types

Steps
- Add schema validation (zod or valibot).
- Define WS protocol types in shared layer: telemetry, status, error, cppText.
- Update server parsing and client sending to use schemas.

Acceptance
- Invalid payloads are rejected with clear errors.
- Backwards compatible with current controller client.

## Phase 4 — UI/UX and Routing Hardening
Outputs
- Route guards and theme consistency

Steps
- Add auth and role guards for /admin and /user.
- Fix Toaster theme dependency by adopting next-themes or mapping to ThemeContext and removing next-themes.
- Extract controller hooks for gamepad, WebSocket, and HID.

Acceptance
- Direct navigation to /admin without admin user redirects.
- No theme warnings or missing provider errors.

## Phase 5 — Tests + CI
Outputs
- Tests for data layer and telemetry
- Basic CI checks

Steps
- Add unit tests for telemetry store and repositories.
- Add smoke tests for routing and WS client.
- Add lint and typecheck scripts.

Acceptance
- CI run is green and fast.
