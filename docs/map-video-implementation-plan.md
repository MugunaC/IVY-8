# Map + Video (Low-Latency) Implementation Plan

## Objective
- Add a high-performance map and live video stream to the control workflow with low latency on Android and desktop.
- Support a bidirectional edge-control path with RP2040/Pico W devices, including authenticated vehicle binding.

## Control UI Baseline (Integrated Before RTOS Rollout)
- Realtime Ops is the default control-page view.
- Operators can enable/disable runtime modules (`map`, `video`, `visualizer`, `stream`) without leaving the control page.
- `Vehicle Info`, `Controller Status`, and `WebSocket URL` are organized as navigable status tabs.
- Data Stream remains available in compact form (reduced viewport height) to avoid dominating the layout.
- Dual-monitor launch actions are first-class:
  - Focus display window (`/control?vehicleId=...&focus=map`)
  - Video-focused window (`/control?vehicleId=...&focus=video`)
  - Chat-focused window (`/control?vehicleId=...&focus=chat`)
  - Controller-focused window (`/control?vehicleId=...&focus=control`)
- When multiple control-capable tabs are open for the same vehicle, the focused visible tab becomes the single active control publisher. Only that tab emits gamepad-driven control/input traffic.

## Tooling + Execution Constraints
- Current agent environment supports local inspection and implementation, but file writes may require elevated permissions when sandboxed read-only.
- To prevent duplicate implementation, protocol extensions must reuse existing `shared/protocol.ts` and `shared/types.ts` contracts.

## Bidirectional Data Modules (Operator <-> Device)
- `control`: operator-to-device actuation commands.
- `location`: device-to-operator position updates.
- `camera`: device camera/session status and control metadata (start/stop/profile/status). Raw video remains on SFU path.
- `sensor_state`: device-to-operator vehicle health and sensor stream (battery, IMU, temperatures, fault flags, etc).

## Optimized MCU Wire Structure
- Use a compact binary frame for high-rate MCU traffic with fixed header + module payload.
- Frame header fields:
  - `v` (u8 protocol version)
  - `module` (u8 enum: control/location/camera/sensor/auth/ack)
  - `flags` (u8 bitfield: ack_required/compressed/error)
  - `seq` (u16)
  - `ts_ms` (u32 device monotonic ms)
  - `vehicle_id_hash` (u32, FNV-1a of canonical vehicle id for fast filter)
  - `len` (u16 payload length)
- Payload follows module-specific packed layout (little-endian), avoiding JSON parse overhead on the MCU hot path.
- Keep JSON messages as compatibility/fallback for web clients and diagnostics.

## What is scaffolded now
- `src/app/components/realtime/MapPanel.tsx`
- `src/app/components/realtime/VideoPanel.tsx`
- `src/app/hooks/useVehicleLocationFeed.ts`
- `src/app/hooks/useSfuSignaling.ts`
- `src/app/hooks/useWebRtcSubscriber.ts`
- `shared/sfu.ts`
- `src/app/components/realtime/FocusMapView.tsx` (shared focus map view)
- Route: `/control` (authenticated) in `src/app/routes.tsx`

## Phase 1: Location Feed Contract (1 day)
- Add server WS message support for:
  - `location_subscribe` request
  - `location` push payload `{ ts, vehicleId, lat, lng, heading?, speedMps? }`
- Send updates at 5-10 Hz max per vehicle.
- Keep payload compact (numbers only, no nested objects).

Done criteria:
- `useVehicleLocationFeed` receives live updates for selected vehicle.
- No frame drops while receiving 10 Hz location packets.

## Phase 2: Map Renderer Integration (1 day)
- Install `maplibre-gl` and wire it into `MapPanel`.
- Use one GeoJSON source and one symbol layer for active vehicle marker.
- Update marker only inside `requestAnimationFrame`.
- Add interpolation between packets using last two timestamps.

Done criteria:
- Stable 60 fps panning on mid-range Android.
- Location marker update latency under 200 ms on LAN.

## Phase 3: Minimal SFU Signaling API (1-2 days)
- Add a small signaling service endpoint (`/signal`) with WebSocket.
- Implement request/response actions:
  - `join`
  - `subscribe` (viewer sends SDP offer, receives SDP answer)
  - `ice_pull` (initial remote candidates)
- Option A (recommended): run LiveKit server, signaling forwards room join + subscribe.
- Option B: mediasoup custom transport if you need full control.

Done criteria:
- `VideoPanel` connects with `Start Stream` and displays remote video.
- Reconnect works after temporary network drop.

## Phase 4: Publishing Path (vehicle/camera side) (1-2 days)
- Implement camera publisher using WebRTC encoder presets:
  - 720p @ 24fps (default)
  - fallback 480p @ 20fps
- Enable simulcast for adaptive clients.
- Cap max bitrate per layer.

Done criteria:
- Single publisher can serve at least 3 concurrent viewers via SFU.
- End-to-end latency stays below 500 ms on good Wi-Fi.

## Phase 5: Hardening + Performance Budget (1 day)
- Add QoS metrics:
  - RTT, packet loss, bitrate, dropped frames.
- Add UI degradation logic:
  - auto-lower resolution if loss > threshold.
- Keep map and video render loops isolated.

Done criteria:
- Video does not block map updates under network stress.
- Auto-recovery from disconnected signaling socket.

## Server integration notes
- Keep existing API server unchanged for auth and CRUD.
- Deploy SFU/signaling as separate process for isolation.
- Add env vars:
  - `VITE_SFU_SIGNALING_URL`
  - `VITE_LOCATION_WS_URL`
  - `SFU_API_KEY` / `SFU_API_SECRET` (server side)

## Suggested next implementation order in this repo
1. Add server `location_subscribe` + `location` WS packets.
2. Wire `FocusMapView` vehicle selection and pass real `vehicleId`.
3. Integrate MapLibre in `MapPanel`.
4. Stand up LiveKit and implement `/signal` bridge.
5. Hook `VideoPanel` to production signaling and publish stream from source device.

## Dual-Monitor Operating Profiles
1. `Pilot + Observer`: monitor A = control page (controller + status), monitor B = ops video/map.
2. `Video Wall`: monitor A = control page, monitor B = `/control?focus=video` for maximum visual area.
3. `Split Ops`: monitor A = control page with map enabled and compact stream, monitor B = control mirror for redundant operator handoff.
