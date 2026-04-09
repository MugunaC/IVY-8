import { describe, expect, it } from 'vitest';
import {
  clearLastVehicleSelection,
  clearWsUrlOverride,
  getLastVehicleSelection,
  getWsUrlOverride,
  setLastVehicleSelection,
  setWsUrlOverride,
} from '@/app/data/settingsRepo';

describe('settingsRepo', () => {
  it('stores and clears ws url override', () => {
    setWsUrlOverride('wss://example.com');
    expect(getWsUrlOverride()).toBe('wss://example.com');
    clearWsUrlOverride();
    expect(getWsUrlOverride()).toBe(null);
  });

  it('stores and clears last vehicle selection', () => {
    setLastVehicleSelection('user-1', 'VH-001');
    expect(getLastVehicleSelection('user-1')).toBe('VH-001');
    clearLastVehicleSelection('user-1');
    expect(getLastVehicleSelection('user-1')).toBe(null);
  });
});
