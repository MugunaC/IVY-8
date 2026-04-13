export type VehicleColorToken = {
  fill: string;
  border: string;
  text: string;
  glow: string;
  mutedFill: string;
};

const VEHICLE_PALETTE: VehicleColorToken[] = [
  { fill: '#38bdf8', border: '#0f172a', text: '#e0f2fe', glow: 'rgba(56,189,248,0.42)', mutedFill: '#475569' },
  { fill: '#f59e0b', border: '#451a03', text: '#fef3c7', glow: 'rgba(245,158,11,0.42)', mutedFill: '#57534e' },
  { fill: '#10b981', border: '#052e16', text: '#d1fae5', glow: 'rgba(16,185,129,0.42)', mutedFill: '#3f4d46' },
  { fill: '#ef4444', border: '#450a0a', text: '#fee2e2', glow: 'rgba(239,68,68,0.38)', mutedFill: '#5b4444' },
  { fill: '#a78bfa', border: '#2e1065', text: '#ede9fe', glow: 'rgba(167,139,250,0.42)', mutedFill: '#4c4663' },
  { fill: '#14b8a6', border: '#042f2e', text: '#ccfbf1', glow: 'rgba(20,184,166,0.42)', mutedFill: '#465554' },
  { fill: '#f97316', border: '#431407', text: '#ffedd5', glow: 'rgba(249,115,22,0.42)', mutedFill: '#5b4a40' },
  { fill: '#e879f9', border: '#500724', text: '#fce7f3', glow: 'rgba(232,121,249,0.42)', mutedFill: '#5a4b57' },
];

function hashVehicleId(vehicleId: string) {
  let hash = 0;
  for (let i = 0; i < vehicleId.length; i += 1) {
    hash = (hash * 31 + vehicleId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getVehicleColor(vehicleId: string | undefined | null): VehicleColorToken {
  if (!vehicleId) return VEHICLE_PALETTE[0];
  return VEHICLE_PALETTE[hashVehicleId(vehicleId) % VEHICLE_PALETTE.length];
}
