import { useRef } from 'react';
import { clientMessageSchema, PROTOCOL_VERSION, serverMessageSchema } from '@shared/protocol';
import { useReconnectingWebSocket } from '@/app/hooks/useReconnectingWebSocket';
import type { WsServerMessage } from '@shared/types';

interface UseTelemetrySocketOptions {
  url: string;
  vehicleId?: string;
  onMessage?: (raw: string) => void;
  onServerMessage?: (message: WsServerMessage) => void;
  onError?: (message: string) => void;
}

export function useTelemetrySocket(options: UseTelemetrySocketOptions) {
  const { url, vehicleId, onMessage, onServerMessage, onError } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const { wsRef: reconnectRef, isConnected } = useReconnectingWebSocket({
    url,
    onOpen: (ws) => {
      wsRef.current = ws;
      const hello = clientMessageSchema.safeParse({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        vehicleId,
      });
      if (hello.success) {
        ws.send(JSON.stringify(hello.data));
      }
    },
    onError: () => {
      onError?.('Telemetry socket error');
    },
    onMessage: (event) => {
      if (typeof event.data !== 'string') return;
      const raw = event.data.trim();
      if (!raw) return;
      onMessage?.(raw);
      try {
        const parsed = serverMessageSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          onServerMessage?.(parsed.data);
        }
      } catch {
        return;
      }
    },
  });

  wsRef.current = reconnectRef.current;
  return { wsRef, isConnected };
}
