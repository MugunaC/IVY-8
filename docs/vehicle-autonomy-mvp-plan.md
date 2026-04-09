# Vehicle Autonomy MVP Plan

## 1. Scope and Approach

Use an existing autopilot core first (ArduPilot or PX4) and keep IVY focused on mission planning, supervision, telemetry, and safety orchestration.

Target operating modes:
- `manual`
- `assisted`
- `guided`
- `auto`

Recommended feature progression:
1. Waypoint following
2. Speed profile per segment
3. Stop/yield zones
4. Return-to-home / park action

## 2. Mission Planning Workflow

Planner capabilities:
- Map waypoint placement
- Route constraints (max speed, stop points, no-go polygons)
- Mission validation before upload

Mission lifecycle:
1. Draft
2. Validate
3. Simulate
4. Arm
5. Execute
6. Monitor
7. Debrief / export logs

Operational integrity:
- Version mission payloads
- Store upload metadata (`who`, `when`, mission checksum)
- Keep immutable audit trail for mission changes and execution outcomes

## 3. Safety Architecture (Mandatory)

Layered failsafes:
- Onboard E-stop (hardware relay/power cut)
- Remote E-stop command
- Heartbeat timeout -> brake/neutral/stop
- Geofence breach -> stop / RTL
- Localization loss -> degraded mode
- Low battery -> safe stop/return
- Manual override always higher priority than autonomy

Pre-arm health gates:
- GPS/IMU validity
- Motor/controller health
- Link quality threshold
- Battery threshold

Safety state machine:
- `DISARMED`
- `READY`
- `ARMED`
- `AUTONOMOUS`
- `FAILSAFE`
- `ESTOP`

## 4. Minimum Viable Hardware (Rover Class)

Compute:
- Autopilot flight controller: Pixhawk-class or Cube
- Companion computer: Raspberry Pi 5 or Jetson Orin Nano

Positioning:
- GNSS + compass minimum
- RTK GNSS preferred for dependable outdoor autonomy

Perception (MVP):
- Start with one: front stereo/depth camera or 2D LiDAR
- Wheel encoders for odometry

Vehicle interfaces:
- Motor controller (ESC/VESC)
- Steering actuator interface
- Independent E-stop circuit (not software-only)

Power:
- Separate regulated rails for compute and actuation
- Battery monitoring telemetry

Comms:
- Primary link (Wi-Fi or LTE)
- Optional backup link for command/E-stop

## 5. Delivery Phases

1. Assisted driving + geofence + heartbeat failsafe
2. Guided waypoint navigation
3. Full mission execution + mission planner UI
4. Perception-based obstacle handling

## 6. IVY Implementation Notes

Suggested IVY responsibilities:
- Mission authoring and validation UX
- Mode switching and command authorization
- Telemetry/health dashboards
- Failsafe visualization and operator alerts
- Mission/event audit logging

Suggested autopilot responsibilities:
- Low-level control loops
- Deterministic mode transitions
- Sensor fusion and state estimation
- Core failsafe execution
