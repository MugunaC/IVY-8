import type { MissionPayload, MissionPlan } from '@shared/types';

export const formatDistanceKm = (meters: number) =>
  Number.isFinite(meters) ? `${(meters / 1000).toFixed(1)} km` : 'n/a';

export const formatSpeedKmh = (mps: number) =>
  Number.isFinite(mps) ? `${(mps * 3.6).toFixed(1)} km/h` : 'n/a';

export const formatHours = (seconds: number) =>
  Number.isFinite(seconds) ? `${(seconds / 3600).toFixed(1)} h` : 'n/a';

export const resolveLatestMission = (entries: MissionPlan[]) => {
  if (!entries.length) return null;
  return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
};

export const buildMissionPayloadFromPlan = (plan: MissionPlan): MissionPayload => ({
  arrivalRadiusM: plan.arrivalRadiusM,
  speedMps: plan.speedMps,
  slowRadiusM: plan.speedMps ? Math.max(2, Math.min(20, plan.speedMps * 3)) : undefined,
  waypoints: plan.waypoints.map((wp) => ({
    lat: wp.lat,
    lng: wp.lng,
    loiterSeconds: plan.loiterSeconds,
  })),
});

export const formatMissionSummary = (plan: MissionPlan | null, regionLabel?: string) => {
  if (!plan) return 'No mission selected';
  const count = plan.waypoints.length;
  const distance =
    typeof plan.distanceMeters === 'number' ? `${(plan.distanceMeters / 1000).toFixed(2)} km` : 'n/a';
  const region = regionLabel ? ` • ${regionLabel}` : '';
  return `${plan.name} • ${count} waypoints • ${distance}${region}`;
};
