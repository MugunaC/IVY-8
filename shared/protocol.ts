import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

export const telemetryPayloadSchema = z.object({
  buttons: z.array(z.number()),
  axes: z.array(z.number()),
  vehicleId: z.string().min(1).optional(),
  leaseId: z.string().min(8).optional(),
  seq: z.number().int().nonnegative().optional(),
});

export const inputPayloadSchema = telemetryPayloadSchema;

export const controlPayloadSchema = z.object({
  seq: z.number().int().nonnegative(),
  leaseId: z.string().min(8),
  buttons: z.array(z.number()),
  axes: z.array(z.number()),
  mode: z.enum(['manual', 'assisted', 'auto']).optional(),
});

export const cameraControlPayloadSchema = z.object({
  seq: z.number().int().nonnegative(),
  action: z.enum(['start', 'stop', 'set_profile']),
  profile: z.enum(['720p24', '480p20']).optional(),
  bitrateKbps: z.number().int().positive().optional(),
});

export const vehicleLocationPayloadSchema = z.object({
  ts: z.number(),
  vehicleId: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  heading: z.number().optional(),
  speedMps: z.number().optional(),
});

export const coopRoleSchema = z.enum(['host', 'driver', 'spectator']);

export const coopParticipantSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(1),
  role: coopRoleSchema,
  vehicleId: z.string().min(1).optional(),
  joinedAt: z.number().nonnegative(),
  lastSeenAt: z.number().nonnegative(),
  isHost: z.boolean(),
  isOnline: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isSpeaking: z.boolean().optional(),
});

export const coopChatMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  vehicleId: z.string().min(1).optional(),
  authorId: z.string().min(1),
  author: z.string().min(1),
  text: z.string().min(1).max(500),
  ts: z.number().nonnegative(),
});

export const coopSessionVehicleSchema = z.object({
  vehicleId: z.string().min(1),
  userId: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  heading: z.number().optional(),
  speedMps: z.number().optional(),
  lastUpdatedAt: z.number().nonnegative().optional(),
});

const missionWaypointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  label: z.string().min(1).optional(),
});

export const coopSharedPlanSchema = z.object({
  sessionId: z.string().min(1),
  vehicleId: z.string().min(1).optional(),
  updatedByUserId: z.string().min(1),
  updatedByUsername: z.string().min(1),
  waypoints: z.array(missionWaypointSchema),
  route: z
    .object({
      type: z.literal('LineString'),
      coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
    })
    .nullish(),
  distanceMeters: z.number().nonnegative().optional(),
  etaSeconds: z.number().nonnegative().optional(),
  version: z.number().int().nonnegative(),
  updatedAt: z.number().nonnegative(),
});

export const coopStatePayloadSchema = z.object({
  sessionId: z.string().min(1),
  invitePath: z.string().min(1),
  hostUserId: z.string().min(1).optional(),
  hostUsername: z.string().min(1).optional(),
  participants: z.array(coopParticipantSchema),
  vehicles: z.array(coopSessionVehicleSchema),
  messages: z.array(coopChatMessageSchema),
  sharedPlan: coopSharedPlanSchema.nullish(),
});

export const cameraStatusPayloadSchema = z.object({
  ts: z.number(),
  vehicleId: z.string().min(1),
  streamId: z.string().min(1).optional(),
  status: z.enum(['idle', 'starting', 'live', 'degraded', 'error']),
  fps: z.number().nonnegative().optional(),
  bitrateKbps: z.number().nonnegative().optional(),
  rttMs: z.number().nonnegative().optional(),
  packetLossPct: z.number().nonnegative().optional(),
  note: z.string().optional(),
});

export const missionPayloadSchema = z.object({
  arrivalRadiusM: z.number().optional(),
  speedMps: z.number().optional(),
  slowRadiusM: z.number().optional(),
  waypoints: z
    .array(
      z.object({
        lat: z.number(),
        lng: z.number(),
        loiterSeconds: z.number().optional(),
      })
    )
    .min(1),
});

export const sensorStatePayloadSchema = z.object({
  ts: z.number(),
  vehicleId: z.string().min(1),
  batteryMv: z.number().int().optional(),
  currentMa: z.number().int().optional(),
  socPct: z.number().min(0).max(100).optional(),
  imu: z
    .object({
      ax: z.number(),
      ay: z.number(),
      az: z.number(),
      gx: z.number(),
      gy: z.number(),
      gz: z.number(),
    })
    .optional(),
  motorTempC: z.number().optional(),
  escTempC: z.number().optional(),
  wheelRpm: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  faults: z.number().int().nonnegative().optional(),
});

export const deviceHelloPayloadSchema = z.object({
  vehicleId: z.string().min(1),
  deviceId: z.string().min(1),
  ts: z.number(),
  nonce: z.string().min(8),
  sig: z.string().min(16),
  fw: z.string().optional(),
  caps: z.array(z.string()).optional(),
});

export const clientMessageSchema = z.union([
  z.object({
    type: z.literal('input'),
    payload: inputPayloadSchema,
    vehicleId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.number().int().nonnegative().optional(),
    vehicleId: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('location_subscribe'), vehicleId: z.string().min(1) }),
  z.object({
    type: z.literal('coop_join'),
    sessionId: z.string().min(1),
    userId: z.string().min(1),
    username: z.string().min(1),
    vehicleId: z.string().min(1).optional(),
    role: coopRoleSchema.optional(),
  }),
  z.object({
    type: z.literal('coop_leave'),
    sessionId: z.string().min(1),
    userId: z.string().min(1),
  }),
  z.object({
    type: z.literal('coop_chat'),
    sessionId: z.string().min(1),
    vehicleId: z.string().min(1).optional(),
    userId: z.string().min(1),
    username: z.string().min(1),
    text: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal('coop_chat_clear'),
    sessionId: z.string().min(1),
    userId: z.string().min(1),
  }),
  z.object({
    type: z.literal('coop_plan_set'),
    sessionId: z.string().min(1),
    vehicleId: z.string().min(1).optional(),
    userId: z.string().min(1),
    username: z.string().min(1),
    waypoints: z.array(missionWaypointSchema),
    route: z
      .object({
        type: z.literal('LineString'),
        coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
      })
      .nullish(),
    distanceMeters: z.number().nonnegative().optional(),
    etaSeconds: z.number().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('coop_plan_clear'),
    sessionId: z.string().min(1),
    userId: z.string().min(1),
  }),
  z.object({
    type: z.literal('device_hello'),
    payload: deviceHelloPayloadSchema,
    protocolVersion: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('control'),
    vehicleId: z.string().min(1),
    payload: controlPayloadSchema,
  }),
  z.object({
    type: z.literal('mission'),
    vehicleId: z.string().min(1),
    payload: missionPayloadSchema,
  }),
  z.object({
    type: z.literal('camera_control'),
    vehicleId: z.string().min(1),
    payload: cameraControlPayloadSchema,
  }),
  z.object({
    type: z.literal('sensor_state'),
    vehicleId: z.string().min(1),
    payload: sensorStatePayloadSchema,
  }),
  z.object({
    type: z.literal('camera_status'),
    vehicleId: z.string().min(1),
    payload: cameraStatusPayloadSchema,
  }),
  z.object({
    type: z.literal('location'),
    payload: vehicleLocationPayloadSchema,
  }),
]);

export const serverMessageSchema = z.union([
  z.object({ type: z.literal('cpp'), text: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({
    type: z.literal('slow_down'),
    retryAfterMs: z.number().int().nonnegative(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('input_ack'),
    ts: z.number(),
    vehicleId: z.string().min(1).optional(),
    received: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('input'),
    payload: inputPayloadSchema,
    vehicleId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('location'),
    payload: vehicleLocationPayloadSchema,
  }),
  z.object({
    type: z.literal('auth_ok'),
    vehicleId: z.string().min(1),
    deviceId: z.string().min(1),
    ts: z.number(),
  }),
  z.object({ type: z.literal('auth_error'), message: z.string() }),
  z.object({
    type: z.literal('device_status'),
    vehicleId: z.string().min(1),
    deviceId: z.string().min(1).optional(),
    online: z.boolean(),
    lastSeenMs: z.number(),
    ip: z.string().min(1).optional(),
    fw: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('control'),
    vehicleId: z.string().min(1),
    payload: controlPayloadSchema,
  }),
  z.object({
    type: z.literal('camera_control'),
    vehicleId: z.string().min(1),
    payload: cameraControlPayloadSchema,
  }),
  z.object({
    type: z.literal('sensor_state'),
    vehicleId: z.string().min(1),
    payload: sensorStatePayloadSchema,
  }),
  z.object({
    type: z.literal('camera_status'),
    vehicleId: z.string().min(1),
    payload: cameraStatusPayloadSchema,
  }),
  z.object({
    type: z.literal('mission'),
    vehicleId: z.string().min(1),
    payload: missionPayloadSchema,
  }),
  z.object({
    type: z.literal('coop_state'),
    payload: coopStatePayloadSchema,
  }),
  z.object({
    type: z.literal('coop_chat'),
    payload: coopChatMessageSchema,
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
