import { getWsUrlOverride } from '@/app/data/settingsRepo';

export function getDefaultLocationWsUrl() {
  const configured = import.meta.env.VITE_LOCATION_WS_URL;
  if (configured) return configured;
  if (import.meta.env.VITE_TELEMETRY_WS_URL) return import.meta.env.VITE_TELEMETRY_WS_URL;
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  if (import.meta.env.DEV) {
    return `${proto}://${window.location.host}/ws/telemetry`;
  }
  return `${proto}://${window.location.hostname}:3001`;
}

export function deriveTelemetryUrlFromControl(controlUrl?: string | null) {
  if (!controlUrl) return null;
  try {
    const url = new URL(controlUrl);
    if (url.port) {
      const port = Number(url.port);
      if (Number.isFinite(port)) {
        url.port = String(port + 1);
        return url.toString();
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function getDefaultControlWsUrl(options?: { includeOverride?: boolean }) {
  if (options?.includeOverride) {
    const override = getWsUrlOverride();
    if (override) return override;
  }
  const configured = import.meta.env.VITE_CONTROL_WS_URL;
  if (configured) return configured;
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  if (import.meta.env.DEV) {
    return `${proto}://${window.location.host}/ws/control`;
  }
  return `${proto}://${window.location.hostname}:3000`;
}

export function getDefaultTelemetryWsUrl(controlOverride?: string | null) {
  const configured = import.meta.env.VITE_TELEMETRY_WS_URL;
  if (configured) return configured;
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const derived = deriveTelemetryUrlFromControl(controlOverride);
  if (derived) return derived;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  if (import.meta.env.DEV) {
    return `${proto}://${window.location.host}/ws/telemetry`;
  }
  return `${proto}://${window.location.hostname}:3001`;
}

export function getDefaultSignalingUrl() {
  const configured = import.meta.env.VITE_SFU_SIGNALING_URL;
  if (configured) return configured;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/signal`;
}
