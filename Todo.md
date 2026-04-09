# Product Roadmap TODO

## Completed in this pass
- [x] Move core app data to server-side persistence
- [x] Remove login demo-credentials message
- [x] Add signup flow on sign-in page
- [x] Allow sign-in with username, email, or user ID
- [x] Add password support for admin-created users
- [x] Add telemetry filters for user and time range
- [x] Improve controller visualizer auto-fit behavior
- [x] Add Android (Termux) deployment workflow

## Vehicle map tracking
- [ ] Add `vehicle_positions` data model (`vehicleId`, `lat`, `lng`, `speed`, `heading`, `ts`)
- [ ] Add `/api/vehicle-positions` ingest endpoint with auth
- [ ] Stream live locations over WebSocket channel for low-latency updates
- [ ] Integrate map UI (Google Maps or MapLibre + OpenStreetMap)
- [ ] Add geo-fence overlays and out-of-bounds alerts
- [ ] Add playback mode for historical route trails by time range

## Onboard camera streaming
- [ ] Define camera ingestion protocol (WebRTC preferred, RTSP gateway fallback)
- [ ] Add stream session service (`streamId`, `vehicleId`, `status`, `lastSeenTs`)
- [ ] Embed low-latency player in control screen
- [ ] Add adaptive bitrate and reconnect handling
- [ ] Add recording retention policy and signed URL playback

## Recommendations
- [ ] Add real authentication session management (JWT + refresh tokens + RBAC middleware)
- [ ] Hash passwords with per-user salt + migration plan (bcrypt/argon2)
- [ ] Add API validation and rate limiting on auth/telemetry endpoints
- [ ] Add audit log tamper protection and retention policy
- [ ] Add first-run bootstrap flow for creating the initial admin user (remove default seed credentials in production)
- [ ] Move from JSON file to managed DB (PostgreSQL) for production scale
- [ ] Add observability: request logs, metrics, alerting, and health checks

## Vehicle autonomy execution backlog

### Phase 0: Foundations (safety and interfaces first)
- [ ] Select autopilot stack (`ArduPilot` or `PX4`) and document integration contract with IVY
- [ ] Define mode/state enums in shared protocol (`manual`, `assisted`, `guided`, `auto`, failsafe states)
- [ ] Add signed command envelope (operator ID, timestamp, nonce, signature) for high-risk commands
- [ ] Add hardware/software E-stop command path and server-side authorization checks
- [ ] Add heartbeat watchdog from IVY to vehicle controller with timeout -> stop/brake behavior

### Phase 1: Assisted driving MVP
- [ ] Implement assisted mode APIs (`arm`, `disarm`, `set_mode`, speed/steer limits)
- [ ] Add pre-arm health checks (battery floor, localization validity, controller health)
- [ ] Add geofence model + breach policy (`warn`, `slow`, `stop`, `rtl`)
- [ ] Add operator UI for mode switching and real-time failsafe state display
- [ ] Add event/audit logging for all mode transitions and safety events

### Phase 2: Guided waypoint navigation
- [ ] Add mission schema v1 (waypoints, speed constraints, stop points, no-go polygons)
- [ ] Build mission validation service (schema + physical constraints + geofence checks)
- [ ] Add `/api/missions` CRUD + versioning + checksum + who/when metadata
- [ ] Add mission upload/activate/cancel endpoints and WebSocket status updates
- [ ] Add map UI for creating/editing waypoint routes and constraints

### Phase 3: Auto mission execution
- [ ] Add mission lifecycle state machine (`draft`, `validated`, `armed`, `running`, `paused`, `completed`, `aborted`)
- [ ] Add dry-run/simulation pass before mission activation
- [ ] Add runtime monitors (deviation, speed compliance, ETA, segment progress)
- [ ] Add automatic fallback actions for link loss/localization loss/low battery
- [ ] Add mission debrief export (timeline, alerts, interventions, telemetry summary)

### Phase 4: Perception and obstacle handling
- [ ] Integrate one perception source first (2D LiDAR or depth camera)
- [ ] Add obstacle policy layer (`slow`, `stop`, `re-route request`)
- [ ] Add planner constraints for dynamic obstacle zones
- [ ] Add operator override workflows for blocked routes

### Hardware bring-up (minimum viable rover kit)
- [ ] Validate autopilot hardware bring-up (Pixhawk/Cube class)
- [ ] Validate companion compute (Raspberry Pi 5 or Jetson Orin Nano)
- [ ] Integrate GNSS + compass (RTK-capable path preferred)
- [ ] Integrate wheel encoder odometry into telemetry path
- [ ] Validate motor/steering interfaces and independent E-stop circuit
- [ ] Validate dual power rails and battery telemetry
- [ ] Validate primary comms link (Wi-Fi/LTE) and backup command path

### Verification and safety acceptance
- [ ] Add HIL/SITL scenarios for geofence breach, heartbeat timeout, and E-stop
- [ ] Add mission validation test suite (invalid geometry, unsafe speeds, no-go violations)
- [ ] Add field test checklist with go/no-go criteria
- [ ] Define minimum safety acceptance metrics before autonomous rollout
