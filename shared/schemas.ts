import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.union([z.literal('admin'), z.literal('user')]),
  email: z.string().email().optional(),
  password: z.string().optional(),
  createdAt: z.string().optional(),
});

export const vehicleSchema = z.object({
  id: z.string(),
  model: z.string(),
  status: z.union([
    z.literal('available'),
    z.literal('unavailable'),
    z.literal('maintenance'),
  ]),
  condition: z.string(),
  assignedUsers: z.array(z.string()),
  location: z.string(),
  charge: z.number(),
  currentUser: z.string().optional(),
  currentUserId: z.string().optional(),
  capabilities: z
    .object({
      vehicleClass: z.union([
        z.literal('copter'),
        z.literal('heli'),
        z.literal('plane'),
        z.literal('rover'),
        z.literal('boat'),
        z.literal('sub'),
        z.literal('blimp'),
        z.literal('unknown'),
      ]),
      supportedModes: z.array(
        z.union([
          z.literal('manual'),
          z.literal('assisted'),
          z.literal('hold'),
          z.literal('guided'),
          z.literal('auto'),
          z.literal('rtl'),
          z.literal('dock'),
        ])
      ),
      supportedModules: z.array(
        z.union([
          z.literal('control'),
          z.literal('location'),
          z.literal('camera_control'),
          z.literal('camera_status'),
          z.literal('sensor_state'),
        ])
      ),
      actuatorMap: z.record(z.string(), z.number()).optional(),
      sensorSet: z.array(z.string()).optional(),
      limits: z
        .object({
          maxSteer: z.number().optional(),
          maxThrottle: z.number().optional(),
          maxBrake: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

export const activityLogSchema = z.object({
  id: z.string(),
  userId: z.string(),
  username: z.string(),
  action: z.union([
    z.literal('login'),
    z.literal('logout'),
    z.literal('vehicle_selected'),
    z.literal('vehicle_unselected'),
    z.literal('vehicle_resumed'),
  ]),
  details: z.string().optional(),
  timestamp: z.string(),
});
