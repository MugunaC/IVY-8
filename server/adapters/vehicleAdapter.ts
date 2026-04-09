import type {
  CameraControlPayload,
  ControlPayload,
  Vehicle,
  VehicleCapabilities,
  VehicleClass,
} from '../../shared/types.js';

type SupportedModule = VehicleCapabilities['supportedModules'][number];

export interface VehicleAdapter {
  readonly vehicleClass: VehicleClass;
  validateControl(payload: ControlPayload, capabilities: VehicleCapabilities): string | null;
  validateCameraControl(
    payload: CameraControlPayload,
    capabilities: VehicleCapabilities
  ): string | null;
}

const SHARED_MODES: VehicleCapabilities['supportedModes'] = [
  'manual',
  'assisted',
  'hold',
  'guided',
  'auto',
  'rtl',
];
const SHARED_MODULES: VehicleCapabilities['supportedModules'] = [
  'control',
  'location',
  'camera_control',
  'camera_status',
  'sensor_state',
];

const CLASS_DEFAULTS: Record<VehicleClass, VehicleCapabilities> = {
  rover: {
    vehicleClass: 'rover',
    supportedModes: [...SHARED_MODES, 'dock'],
    supportedModules: SHARED_MODULES,
    actuatorMap: { steer: 0, throttle: 1, brake: 2 },
    sensorSet: ['battery', 'imu', 'temperature', 'wheel_rpm', 'gps'],
    limits: { maxSteer: 1, maxThrottle: 1, maxBrake: 1 },
  },
  copter: {
    vehicleClass: 'copter',
    supportedModes: SHARED_MODES,
    supportedModules: SHARED_MODULES,
    actuatorMap: { roll: 0, pitch: 1, yaw: 2, thrust: 3 },
    sensorSet: ['battery', 'imu', 'barometer', 'gps'],
    limits: { maxSteer: 1, maxThrottle: 1, maxBrake: 1 },
  },
  heli: {
    vehicleClass: 'heli',
    supportedModes: SHARED_MODES,
    supportedModules: SHARED_MODULES,
    actuatorMap: { roll: 0, pitch: 1, yaw: 2, collective: 3 },
    sensorSet: ['battery', 'imu', 'barometer', 'gps', 'rpm'],
    limits: { maxSteer: 1, maxThrottle: 1, maxBrake: 1 },
  },
  plane: {
    vehicleClass: 'plane',
    supportedModes: SHARED_MODES,
    supportedModules: SHARED_MODULES,
    actuatorMap: { roll: 0, pitch: 1, yaw: 2, throttle: 3 },
    sensorSet: ['battery', 'imu', 'barometer', 'airspeed', 'gps'],
    limits: { maxSteer: 1, maxThrottle: 1, maxBrake: 1 },
  },
  boat: {
    vehicleClass: 'boat',
    supportedModes: [...SHARED_MODES, 'dock'],
    supportedModules: SHARED_MODULES,
    actuatorMap: { steer: 0, throttle: 1 },
    sensorSet: ['battery', 'imu', 'gps', 'current'],
    limits: { maxSteer: 1, maxThrottle: 1, maxBrake: 1 },
  },
  sub: {
    vehicleClass: 'sub',
    supportedModes: SHARED_MODES,
    supportedModules: SHARED_MODULES,
    actuatorMap: { surge: 0, sway: 1, heave: 2, yaw: 3 },
    sensorSet: ['battery', 'imu', 'pressure', 'leak'],
    limits: { maxSteer: 1, maxThrottle: 1, maxBrake: 1 },
  },
  blimp: {
    vehicleClass: 'blimp',
    supportedModes: SHARED_MODES,
    supportedModules: SHARED_MODULES,
    actuatorMap: { yaw: 0, thrust: 1, altitude: 2 },
    sensorSet: ['battery', 'imu', 'barometer', 'gps'],
    limits: { maxSteer: 1, maxThrottle: 1, maxBrake: 1 },
  },
  unknown: {
    vehicleClass: 'unknown',
    supportedModes: ['manual', 'hold'],
    supportedModules: ['control', 'location', 'sensor_state'],
    actuatorMap: { steer: 0, throttle: 1 },
    sensorSet: ['battery'],
    limits: { maxSteer: 1, maxThrottle: 1, maxBrake: 1 },
  },
};

class GenericVehicleAdapter implements VehicleAdapter {
  readonly vehicleClass: VehicleClass;

  constructor(vehicleClass: VehicleClass) {
    this.vehicleClass = vehicleClass;
  }

  validateControl(payload: ControlPayload, capabilities: VehicleCapabilities): string | null {
    if (payload.buttons.some((value) => !Number.isFinite(value))) {
      return `Control buttons contain non-finite values for ${capabilities.vehicleClass}.`;
    }
    if (payload.axes.some((value) => !Number.isFinite(value))) {
      return `Control axes contain non-finite values for ${capabilities.vehicleClass}.`;
    }
    if (payload.mode && !capabilities.supportedModes.includes(payload.mode)) {
      return `Mode '${payload.mode}' not supported for ${capabilities.vehicleClass}.`;
    }
    return null;
  }

  validateCameraControl(
    payload: CameraControlPayload,
    capabilities: VehicleCapabilities
  ): string | null {
    if (payload.action === 'set_profile' && !payload.profile) {
      return `Camera profile required for set_profile on ${capabilities.vehicleClass}.`;
    }
    if (payload.bitrateKbps !== undefined && (!Number.isFinite(payload.bitrateKbps) || payload.bitrateKbps <= 0)) {
      return `Invalid camera bitrate for ${capabilities.vehicleClass}.`;
    }
    return null;
  }
}

function inferVehicleClass(model: string): VehicleClass {
  const text = model.toLowerCase();
  if (text.includes('blimp')) return 'blimp';
  if (text.includes('sub') || text.includes('submarine')) return 'sub';
  if (text.includes('boat') || text.includes('sail')) return 'boat';
  if (text.includes('heli')) return 'heli';
  if (text.includes('plane') || text.includes('fixed wing')) return 'plane';
  if (text.includes('copter') || text.includes('drone') || text.includes('quad')) return 'copter';
  if (text.includes('rover') || text.includes('car') || text.includes('truck')) return 'rover';
  return 'unknown';
}

export function withVehicleCapabilities(vehicle: Vehicle): Vehicle {
  if (vehicle.capabilities) {
    return vehicle;
  }
  const inferredClass = inferVehicleClass(vehicle.model);
  return {
    ...vehicle,
    capabilities: CLASS_DEFAULTS[inferredClass],
  };
}

export function getVehicleAdapter(vehicle: Vehicle): VehicleAdapter {
  const vehicleClass = vehicle.capabilities?.vehicleClass || inferVehicleClass(vehicle.model);
  return new GenericVehicleAdapter(vehicleClass);
}

export function supportsModule(vehicle: Vehicle, module: SupportedModule): boolean {
  const next = withVehicleCapabilities(vehicle);
  return !!next.capabilities?.supportedModules.includes(module);
}

export function defaultVehicleCapabilities(vehicleClass: VehicleClass): VehicleCapabilities {
  return CLASS_DEFAULTS[vehicleClass];
}
