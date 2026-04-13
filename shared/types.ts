export type UserRole = 'admin' | 'user';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  email?: string;
  password?: string;
  createdAt?: string;
}

export type VehicleStatus = 'available' | 'unavailable' | 'maintenance';

export type VehicleClass =
  | 'copter'
  | 'heli'
  | 'plane'
  | 'rover'
  | 'boat'
  | 'sub'
  | 'blimp'
  | 'unknown';

export type CanonicalVehicleMode =
  | 'manual'
  | 'assisted'
  | 'hold'
  | 'guided'
  | 'auto'
  | 'rtl'
  | 'dock';

export interface VehicleControlLimits {
  maxSteer?: number;
  maxThrottle?: number;
  maxBrake?: number;
}

export interface VehicleCapabilities {
  vehicleClass: VehicleClass;
  supportedModes: CanonicalVehicleMode[];
  supportedModules: Array<'control' | 'location' | 'camera_control' | 'camera_status' | 'sensor_state'>;
  actuatorMap?: Record<string, number>;
  sensorSet?: string[];
  limits?: VehicleControlLimits;
}

export interface Vehicle {
  id: string;
  model: string;
  status: VehicleStatus;
  condition: string;
  assignedUsers: string[];
  location: string;
  charge: number;
  currentUser?: string;
  currentUserId?: string;
  controlLeaseId?: string;
  controlLeaseIssuedAt?: string;
  capabilities?: VehicleCapabilities;
}

export type ActivityAction =
  | 'login'
  | 'logout'
  | 'vehicle_selected'
  | 'vehicle_unselected'
  | 'vehicle_resumed';

export interface ActivityLog {
  id: string;
  userId: string;
  username: string;
  action: ActivityAction;
  details?: string;
  timestamp: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ActivityLogStats {
  login: number;
  logout: number;
  vehicle_selected: number;
  vehicle_unselected: number;
  vehicle_resumed: number;
}

export interface ActivityLogPage extends PaginatedResult<ActivityLog> {
  stats: ActivityLogStats;
  availableActions: ActivityAction[];
}

export interface TelemetryPayload {
  buttons: number[];
  axes: number[];
  vehicleId?: string;
  leaseId?: string;
  seq?: number;
}

export type InputPayload = TelemetryPayload;

export interface VehicleLocationPayload {
  ts: number;
  vehicleId: string;
  lat: number;
  lng: number;
  heading?: number;
  speedMps?: number;
}

export type RealtimeModule = 'auth' | 'control' | 'location' | 'camera' | 'sensor_state' | 'ack';

export interface DeviceHelloPayload {
  vehicleId: string;
  deviceId: string;
  ts: number;
  nonce: string;
  sig: string;
  fw?: string;
  caps?: string[];
}

export interface ControlPayload {
  seq: number;
  leaseId: string;
  buttons: number[];
  axes: number[];
  mode?: 'manual' | 'assisted' | 'auto';
}

export interface CameraControlPayload {
  seq: number;
  action: 'start' | 'stop' | 'set_profile';
  profile?: '720p24' | '480p20';
  bitrateKbps?: number;
}

export interface CameraStatusPayload {
  ts: number;
  vehicleId: string;
  streamId?: string;
  status: 'idle' | 'starting' | 'live' | 'degraded' | 'error';
  fps?: number;
  bitrateKbps?: number;
  rttMs?: number;
  packetLossPct?: number;
  note?: string;
}

export interface SensorStatePayload {
  ts: number;
  vehicleId: string;
  batteryMv?: number;
  currentMa?: number;
  socPct?: number;
  imu?: {
    ax: number;
    ay: number;
    az: number;
    gx: number;
    gy: number;
    gz: number;
  };
  motorTempC?: number;
  escTempC?: number;
  wheelRpm?: [number, number, number, number];
  faults?: number;
}

export type CoopRole = 'host' | 'driver' | 'spectator';

export interface CoopParticipant {
  userId: string;
  username: string;
  role: CoopRole;
  vehicleId?: string;
  joinedAt: number;
  lastSeenAt: number;
  isHost: boolean;
}

export interface CoopChatMessage {
  id: string;
  sessionId: string;
  vehicleId?: string;
  authorId: string;
  author: string;
  text: string;
  ts: number;
}

export interface CoopSessionVehicle {
  vehicleId: string;
  userId?: string;
  username?: string;
  lat?: number;
  lng?: number;
  heading?: number;
  speedMps?: number;
  lastUpdatedAt?: number;
}

export interface CoopSharedRoute {
  sessionId: string;
  vehicleId?: string;
  authorId: string;
  author: string;
  label?: string;
  route: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  distanceMeters?: number;
  etaSeconds?: number;
  sharedAt: number;
}

export interface CoopStatePayload {
  sessionId: string;
  invitePath: string;
  hostUserId?: string;
  hostUsername?: string;
  participants: CoopParticipant[];
  vehicles: CoopSessionVehicle[];
  messages: CoopChatMessage[];
  sharedRoute?: CoopSharedRoute | null;
}

export interface TelemetryEntry {
  id?: number;
  ts: number;
  userId?: string;
  username?: string;
  vehicleId?: string;
  payload: TelemetryPayload;
  bytes: number;
}

export type MissionPathType = 'straight' | 'roads';

export interface MissionWaypoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface MissionPlan {
  id: string;
  vehicleId: string;
  name: string;
  pathType: MissionPathType;
  speedMps: number;
  waypoints: MissionWaypoint[];
  route?: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  distanceMeters?: number;
  etaSeconds?: number;
  profile?: 'rover' | 'drone';
  arrivalRadiusM?: number;
  loiterSeconds?: number;
  cruiseAltitudeM?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MissionPayload {
  arrivalRadiusM?: number;
  speedMps?: number;
  slowRadiusM?: number;
  waypoints: Array<{
    lat: number;
    lng: number;
    loiterSeconds?: number;
  }>;
}

export interface RecordEntry {
  id?: number;
  ts: number;
  action: string;
  details?: string;
  userId?: string;
  username?: string;
  vehicleId?: string;
}

export type WsClientMessage =
  | { type: 'input'; payload: InputPayload; vehicleId?: string }
  | { type: 'hello'; protocolVersion?: number; vehicleId?: string }
  | { type: 'location_subscribe'; vehicleId: string }
  | {
      type: 'coop_join';
      sessionId: string;
      userId: string;
      username: string;
      vehicleId?: string;
      role?: CoopRole;
    }
  | { type: 'coop_leave'; sessionId: string; userId: string }
  | { type: 'coop_chat'; sessionId: string; vehicleId?: string; userId: string; username: string; text: string }
  | {
      type: 'coop_share_route';
      sessionId: string;
      vehicleId?: string;
      userId: string;
      username: string;
      label?: string;
      route: { type: 'LineString'; coordinates: [number, number][] };
      distanceMeters?: number;
      etaSeconds?: number;
    }
  | { type: 'coop_clear_route'; sessionId: string }
  | { type: 'device_hello'; payload: DeviceHelloPayload; protocolVersion?: number }
  | { type: 'control'; vehicleId: string; payload: ControlPayload }
  | { type: 'mission'; vehicleId: string; payload: MissionPayload }
  | { type: 'camera_control'; vehicleId: string; payload: CameraControlPayload }
  | { type: 'sensor_state'; vehicleId: string; payload: SensorStatePayload }
  | { type: 'camera_status'; vehicleId: string; payload: CameraStatusPayload }
  | { type: 'location'; payload: VehicleLocationPayload };

export type WsServerMessage =
  | { type: 'cpp'; text: string }
  | { type: 'error'; message: string }
  | { type: 'slow_down'; retryAfterMs: number; reason?: string }
  | { type: 'input_ack'; ts: number; vehicleId?: string; received: number }
  | { type: 'input'; payload: InputPayload; vehicleId?: string }
  | { type: 'location'; payload: VehicleLocationPayload }
  | { type: 'auth_ok'; vehicleId: string; deviceId: string; ts: number }
  | { type: 'auth_error'; message: string }
  | {
      type: 'device_status';
      vehicleId: string;
      deviceId?: string;
      online: boolean;
      lastSeenMs: number;
      ip?: string;
      fw?: string;
    }
  | { type: 'control'; vehicleId: string; payload: ControlPayload }
  | { type: 'camera_control'; vehicleId: string; payload: CameraControlPayload }
  | { type: 'sensor_state'; vehicleId: string; payload: SensorStatePayload }
  | { type: 'camera_status'; vehicleId: string; payload: CameraStatusPayload }
  | { type: 'mission'; vehicleId: string; payload: MissionPayload }
  | { type: 'coop_state'; payload: CoopStatePayload }
  | { type: 'coop_chat'; payload: CoopChatMessage };
