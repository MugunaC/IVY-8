# IVY <-> RTOS Interface Report

## Scope
- Control stack: IVY web app + Node WS server + RP2040/Pico W RTOS target.
- Vehicle classes: rover, boat, drone/copter, generic air/ground/water adapters.
- Core requirement: each control session is bound to a `vehicleId` and validated on the edge/device path.

## Runtime Topology
1. Operator opens IVY control page (`/control`).
2. The active focused IVY control/focus tab for a vehicle emits telemetry and control messages over WebSocket to IVY backend.
3. Backend validates session/auth and resolves active `vehicleId`.
4. Vehicle adapter forwards canonical commands to RTOS transport (serial/UDP/TCP bridge).
5. Pico W RTOS task receives commands, checks `vehicleId`/hash binding, and applies actuator output.
6. RTOS publishes location/sensor/camera-status upstream to backend.
7. Backend fans out updates to UI (`/control` and focus windows via `?focus=`).

## Browser Control Arbitration
- IVY can keep multiple control-capable tabs open for the same vehicle, but only one browser tab is allowed to publish gamepad-driven control at a time.
- The focused visible tab becomes the active control publisher and takes over silently on focus/visibility changes.
- This arbitration happens in the browser before messages are sent to the backend.
- The control payload schema sent to the backend and device does not change as a result of this arbitration.

## Data Planes
- `Control plane` (bidirectional, low-latency, critical):
  - mode changes, arming/disarming, steering/throttle, failsafe, heartbeat.
- `State plane` (device -> app):
  - location, battery, attitude, system health, fault flags, actuator feedback.
- `Media plane` (camera):
  - WebRTC/SFU stream path for video frames.
  - control plane carries camera session commands/state, not raw frames.

## Vehicle Identity and Validation
- Canonical `vehicleId` travels on every control payload from IVY.
- Backend rejects commands when:
  - session not authorized for requested vehicle.
  - requested mode unsupported by adapter capabilities.
  - stale sequence/window violation (if enabled).
- RTOS verifies `vehicleId` binding via hashed ID in compact frame header.
- Recommended device policy:
  - ignore control packets with mismatched `vehicle_id_hash`.
  - require periodic authenticated heartbeat; enter failsafe on timeout.

## Fast Transport Structure for Pico W
- Recommended packed frame:
  - `v:u8`, `module:u8`, `flags:u8`, `seq:u16`, `ts_ms:u32`, `vehicle_id_hash:u32`, `len:u16`, `payload`.
- Rationale:
  - fixed header enables O(1) routing and validation on RP2040.
  - avoids JSON parsing overhead on hot path.
  - keeps compatibility by allowing JSON bridge packets at app/backend edge.

## RTOS Task Model (Pico W)
- `rx_task`: receives frames, validates header/vehicle, enqueues command events.
- `control_task`: applies commands to mixers/PWM outputs at fixed tick.
- `sensor_task`: samples IMU/GNSS/power and publishes state at capped rates.
- `net_task`: handles socket keepalive/reconnect and outbound batching.
- `failsafe_task`: monitors heartbeat, link quality, and sensor sanity.

## IVY UI and Operator Workflow
- Default view is `Realtime Ops` in control page tabs.
- Module toggles allow enabling/disabling map/video/visualizer/stream at runtime.
- `Vehicle Info`, `Controller Status`, and `WebSocket URL` are separated into status tabs.
- Data stream is compact to keep focus on active control surfaces.
- Dual-monitor options:
  - Focus window for map/video overview (`/control?focus=map` or `focus=video`).
  - Control mirror window with vehicle context in query params.

## Persistence and Telemetry Storage
- User/session data remains in `server/data/db.json`.
- Telemetry is isolated to `server/data/telemetry.json`.
- Server enforces max telemetry DB size (`TELEMETRY_DB_MAX_BYTES`, default 20 MB) and trims old records.
- Legacy telemetry migration from `db.json` is handled at startup.

## Hardening and Performance Recommendations
- Backend:
  - add per-vehicle outbound rate limits and burst controls.
  - add sequence tracking + replay window on control channel.
  - add binary ws path for high-rate telemetry/control frames.
- Frontend:
  - lazy-load heavy ops modules and visualizer for lower initial bundle.
  - split map/video/control chunks with manual chunking.
  - throttle non-critical UI renders (terminal/status) to avoid blocking control loop.
- Device/bridge:
  - pin control loop period; decouple transport jitter with ring buffers.
  - enforce deterministic failsafe transitions on link loss.
  - keep sensor publish rates adaptive under weak links.

## Verification Completed
- Server compile: `npm run build:ws`
- Frontend/server typecheck: `npm run typecheck`
- Tests: `npm run test`
- Production build: `npm run build`

All checks passed at the time of this report.
