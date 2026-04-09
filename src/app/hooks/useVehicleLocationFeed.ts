import { useEffect, useMemo, useRef, useState } from 'react';

export interface VehicleLocation {
  ts: number;
  vehicleId: string;
  lat: number;
  lng: number;
  heading?: number;
  speedMps?: number;
}

interface UseVehicleLocationFeedOptions {
  wsUrl: string;
  vehicleId: string;
}

interface FeedState {
  latest: VehicleLocation | null;
  isConnected: boolean;
  error: string | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function useVehicleLocationFeed(options: UseVehicleLocationFeedOptions) {
  const { wsUrl, vehicleId } = options;
  const [state, setState] = useState<FeedState>({
    latest: null,
    isConnected: false,
    error: null,
  });
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!wsUrl) {
      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: 'Location socket URL missing',
      }));
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: 'Invalid location socket URL',
      }));
      return;
    }
    socketRef.current = ws;

    ws.onopen = () => {
      setState((prev) => ({ ...prev, isConnected: true, error: null }));
      ws.send(
        JSON.stringify({
          type: 'location_subscribe',
          vehicleId,
        })
      );
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const parsed = JSON.parse(event.data) as {
          type?: string;
          payload?: Record<string, unknown>;
        };
        if (parsed.type !== 'location') return;
        const payload = parsed.payload || {};
        const next: VehicleLocation = {
          ts: isFiniteNumber(payload.ts) ? payload.ts : Date.now(),
          vehicleId: String(payload.vehicleId || ''),
          lat: Number(payload.lat),
          lng: Number(payload.lng),
          heading: isFiniteNumber(payload.heading) ? payload.heading : undefined,
          speedMps: isFiniteNumber(payload.speedMps) ? payload.speedMps : undefined,
        };

        if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return;
        if (next.vehicleId && next.vehicleId !== vehicleId) return;

        setState((prev) => ({
          ...prev,
          latest: next,
        }));
      } catch {
        setState((prev) => ({ ...prev, error: 'Invalid location packet' }));
      }
    };

    ws.onerror = () => {
      setState((prev) => ({ ...prev, error: 'Location socket error' }));
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, isConnected: false }));
    };

    return () => {
      ws.close();
      socketRef.current = null;
    };
  }, [vehicleId, wsUrl]);

  return useMemo(
    () => ({
      latest: state.latest,
      isConnected: state.isConnected,
      error: state.error,
    }),
    [state.error, state.isConnected, state.latest]
  );
}
