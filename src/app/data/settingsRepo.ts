import { STORAGE_KEYS, readString, writeString, removeKey } from './storage';

export function getWsUrlOverride(): string | null {
  return readString(STORAGE_KEYS.wsUrlOverride);
}

export function setWsUrlOverride(url: string) {
  writeString(STORAGE_KEYS.wsUrlOverride, url);
}

export function clearWsUrlOverride() {
  removeKey(STORAGE_KEYS.wsUrlOverride);
}

export function getLastVehicleSelection(userId: string): string | null {
  return readString(STORAGE_KEYS.lastVehicle(userId));
}

export function setLastVehicleSelection(userId: string, vehicleId: string) {
  writeString(STORAGE_KEYS.lastVehicle(userId), vehicleId);
}

export function clearLastVehicleSelection(userId: string) {
  removeKey(STORAGE_KEYS.lastVehicle(userId));
}
