import type { TelemetryPayload } from '@shared/types';

export interface GamepadState {
  buttons: number[];
  axes: number[];
  connected: boolean;
}

const AXIS_DEADZONE = 0.08;
const ANALOG_EPS = 0.01;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const round = (value: number, decimals: number) => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

export const normalizeAxis = (value: number) => {
  const deadzoned = Math.abs(value) < AXIS_DEADZONE ? 0 : value;
  return round(clamp(deadzoned, -1, 1), 2);
};

export const normalizeButton = (value: number) => round(clamp(value, 0, 1), 2);

const toRad = (value: number) => (value * Math.PI) / 180;

export const haversineMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const radius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const calc = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(calc)));
};

export const hasStateChanged = (prev: TelemetryPayload | null, next: TelemetryPayload) => {
  if (!prev) return true;
  if (prev.buttons.length !== next.buttons.length || prev.axes.length !== next.axes.length) return true;
  for (let i = 0; i < prev.buttons.length; i += 1) {
    if (Math.abs(prev.buttons[i] - next.buttons[i]) > ANALOG_EPS) return true;
  }
  for (let i = 0; i < prev.axes.length; i += 1) {
    if (Math.abs(prev.axes[i] - next.axes[i]) > ANALOG_EPS) return true;
  }
  return false;
};

export const hasGamepadUiChanged = (
  prev: GamepadState,
  nextButtons: number[],
  nextAxes: number[],
  connected: boolean
) => {
  if (prev.connected !== connected) return true;
  if (prev.buttons.length !== nextButtons.length || prev.axes.length !== nextAxes.length) return true;
  for (let i = 0; i < prev.buttons.length; i += 1) {
    if (Math.abs(prev.buttons[i] - nextButtons[i]) > ANALOG_EPS) return true;
  }
  for (let i = 0; i < prev.axes.length; i += 1) {
    if (Math.abs(prev.axes[i] - nextAxes[i]) > ANALOG_EPS) return true;
  }
  return false;
};
