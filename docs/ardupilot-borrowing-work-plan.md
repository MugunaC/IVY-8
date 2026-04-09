# ArduPilot Borrowing Work Plan (Multi-Vehicle IVY)

## Goal
Build IVY so one app can safely operate multiple vehicle classes (drones, copters, rovers, boats, subs) with low latency, strong safety, and reusable interfaces.

## Repository Scan Summary
Inspected at:
- `C:\Users\DELL XPS 9360\Documents\Github Repositories\ardupilot`

High-value sources reviewed:
- `libraries/AP_Vehicle/AP_Vehicle.h`
- `libraries/AP_Vehicle/AP_Vehicle.cpp`
- `Rover/Rover.h`
- `libraries/AP_ExternalControl/AP_ExternalControl.h`
- `libraries/AP_Arming/AP_Arming.h`
- `libraries/SRV_Channel/SRV_Channel.h`
- `libraries/AP_Mission/AP_Mission.h`
- `libraries/AP_Param/AP_Param.h`
- `libraries/GCS_MAVLink/GCS.h`
- `Tools/autotest/autotest.py`
- `Tools/autotest/sim_vehicle.py`

## What To Borrow (Design Patterns)

### 1) Unified vehicle base + per-vehicle specializations
Borrow pattern:
- Single common vehicle interface with subclass implementations (`AP_Vehicle` -> Rover/Copter/Plane/Sub style).

Adopt in IVY:
- Introduce `VehicleAdapter` contract in server/RTOS boundary:
  - `arm()`, `disarm()`, `set_mode()`, `set_control()`, `set_target()`, `estop()`
  - `read_state()` returns normalized state for UI.
- Implement adapters: `RoverAdapter`, `CopterAdapter`, `BoatAdapter`, `SubAdapter`.

Why:
- One app UX, different dynamics behind a stable API.

### 2) Explicit mode/state machine per vehicle type
Borrow pattern:
- Vehicle-specific mode classes (`ModeManual`, `ModeGuided`, `ModeAuto`, etc).

Adopt in IVY:
- Standard mode schema with per-vehicle mapping:
  - Canonical: `manual`, `hold`, `guided`, `auto`, `rtl`, `dock` (optional)
  - Vehicle adapter translates to hardware-specific modes.
- Enforce mode-change reason and policy checks.

Why:
- Prevents unsafe mode transitions and keeps UI portable.

### 3) Safety-first arming/failsafe gate
Borrow pattern:
- Centralized arming checks and method/reason tracking (`AP_Arming`).

Adopt in IVY:
- Pre-control gate before any actuation:
  - Authenticated device session
  - Vehicle ownership/session lock
  - Sensor health minimums
  - RC/command freshness
  - Battery/thermal/fault checks
- Standardized disarm reason codes persisted in telemetry.

Why:
- Multi-vehicle support fails without consistent safety policy.

### 4) Actuator function mapping (not hardcoded channel wiring)
Borrow pattern:
- Function-based output mapping and e-stop handling (`SRV_Channel`).

Adopt in IVY:
- `actuator_map` per vehicle profile:
  - logical outputs (`steer`, `throttle`, `yaw_rate`, `motor_n`, `winch`) -> physical channels
- Server sends logical commands only; RTOS maps physically.

Why:
- Supports heterogeneous hardware without UI/protocol rewrites.

### 5) Command/mission model with typed command payloads
Borrow pattern:
- Structured mission command unions and storage (`AP_Mission`).

Adopt in IVY:
- Define compact command set:
  - `NAV_WAYPOINT`, `SET_SPEED`, `CAMERA_START`, `CAMERA_STOP`, `ACTUATOR_SET`, `HOLD`, `RTL`
- Add per-vehicle command capability matrix and validation.

Why:
- Enables autonomous and semi-autonomous flows across classes.

### 6) Parameter registry with namespacing and defaults
Borrow pattern:
- Strong typed parameter system with metadata and persistence (`AP_Param`).

Adopt in IVY:
- Add `vehicle_profile_params` with typed schema:
  - control limits, geometry, fail thresholds, sensor calibration
- Version each profile and support migration.

Why:
- Avoids per-vehicle hardcoded constants and brittle config files.

### 7) Stream-controlled telemetry and protocol budgeting
Borrow pattern:
- Message interval and channel-aware streaming (`GCS_MAVLink`).

Adopt in IVY:
- Per-module rate control:
  - control: 20-100 Hz
  - location: 5-20 Hz
  - sensor_state: 2-20 Hz by profile
  - camera_status: 1-5 Hz
- Backpressure policy and drop strategy per stream priority.

Why:
- Stable latency under weak links.

### 8) Simulation-first validation pipeline
Borrow pattern:
- Extensive SITL/autotest workflows (`Tools/autotest/*`).

Adopt in IVY:
- Build hardware-agnostic simulation harness:
  - virtual rover/copter/boat dynamics stubs
  - contract tests for control and failsafe behavior
  - replay logs for regressions

Why:
- Faster, safer iteration before real hardware.

## What NOT To Borrow Directly
- Do not copy ArduPilot source modules into IVY without license strategy.
- ArduPilot is GPLv3 (`COPYING.txt` in that repo). If IVY is not GPL-compatible, copy ideas and interfaces, not code.
- Keep IVY protocol and runtime lean; avoid importing full MAVLink stack into Pico W path unless required.

## Proposed Target Architecture For IVY
- `Operator App (Web)` -> sends canonical control/mode/camera commands.
- `IVY Gateway Server` -> auth, routing, policy, rate shaping, logs.
- `Vehicle Adapter Layer` -> per-class translation and capability checks.
- `RTOS Edge Agent (Pico W / future boards)` -> transport, watchdog, actuator map, sensor uplink.
- `Media Plane` -> SFU/WebRTC for camera stream (separate from control channel).

## Work Plan

### Phase 0: Guardrails and Contracts (2-3 days)
- Define canonical vehicle capability schema:
  - `vehicleClass`, `supportedModes`, `actuatorMap`, `sensorSet`, `limits`.
- Freeze bidirectional message contracts for:
  - `control`, `location`, `sensor_state`, `camera_control`, `camera_status`, `auth`.
- Add GPL note in architecture docs to avoid accidental source copy.

Deliverables:
- `shared/protocol.ts` and `shared/types.ts` finalized for multi-vehicle.
- `docs/vehicle-capability-schema.md`.

Execution status:
- In progress.
- Completed now:
  - Vehicle capability model added to shared types/schema.
  - Initial server adapter layer added with per-class defaults and validation hooks.
  - Command routing now validates vehicle capabilities before forwarding.

### Phase 1: Adapter Layer (4-6 days)
- Implement `VehicleAdapter` interface in server runtime.
- Add first adapters:
  - `RoverAdapter` and `CopterAdapter`.
- Add capability enforcement:
  - reject unsupported mode/command per vehicle.

Deliverables:
- `server/adapters/*`
- Validation tests per adapter.

### Phase 2: Safety/Arming Engine (3-4 days)
- Implement pre-control gate and failsafe matrix:
  - stale command timeout
  - auth/session mismatch
  - estop propagation
  - battery/fault thresholds.
- Persist arm/disarm/failsafe reasons.

Deliverables:
- `server/safety/*`
- alarm + audit logs.

### Phase 3: Actuator Mapping + RTOS Profile (4-6 days)
- Add per-vehicle actuator map in config store.
- Implement RTOS-side logical-to-physical control map.
- Add per-class defaults for rover/copter/boat.

Deliverables:
- `RTOS/include/ivy_protocol.h` integration with profile map.
- `server` API for map/profile updates.

### Phase 4: Sensor and Camera Module Normalization (3-5 days)
- Normalize sensor payloads by vehicle class:
  - common core + extension fields.
- Integrate camera status/control lifecycle with SFU metadata.

Deliverables:
- Unified sensor cards in UI.
- camera status panel tied to vehicle health.

### Phase 5: Simulation and Regression Harness (5-7 days)
- Add simulation runners for rover/copter/boat command loops.
- Add end-to-end tests:
  - mode transitions
  - failsafe triggers
  - reconnection behavior
  - packet loss tolerance.

Deliverables:
- CI suite with deterministic scenario playback.

## Immediate Next Actions (Recommended)
1. Implement `VehicleAdapter` interface and register `RoverAdapter` + `CopterAdapter`.
2. Add `vehicle_capabilities` object to existing vehicle records in server storage.
3. Add server-side command validator that enforces capability + safety gate before forwarding to RTOS.
