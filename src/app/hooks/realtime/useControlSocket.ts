import { useRef } from 'react';
import { clientMessageSchema, serverMessageSchema, PROTOCOL_VERSION } from '@shared/protocol';
import type { WsServerMessage } from '@shared/types';
import { useReconnectingWebSocket } from '@/app/hooks/useReconnectingWebSocket';

interface UseControlSocketOptions {
  url: string;
  vehicleId: string;
  onOpen?: (ws: WebSocket) => void;
  onDeviceStatus?: (status: {
    online: boolean;
    lastSeenMs: number;
    deviceId?: string;
    ip?: string;
    fw?: string;
  }) => void;
  onError?: (message: string) => void;
  onServerMessage?: (message: WsServerMessage) => void;
}

export function useControlSocket(options: UseControlSocketOptions) {
  const { url, vehicleId, onOpen, onDeviceStatus, onError, onServerMessage } = options;
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
      onOpen?.(ws);
    },
    onClose: () => {
      onDeviceStatus?.({ online: false, lastSeenMs: Date.now() });
    },
    onError: () => {
      onDeviceStatus?.({ online: false, lastSeenMs: Date.now() });
      onError?.('Control socket error');
    },
    onMessage: (event) => {
      if (typeof event.data !== 'string') return;
      const raw = event.data.trim();
      if (!raw) return;
      try {
        const parsed = serverMessageSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) return;
        onServerMessage?.(parsed.data);
        if (parsed.data.type === 'device_status' && parsed.data.vehicleId === vehicleId) {
          onDeviceStatus?.({
            online: parsed.data.online,
            lastSeenMs: parsed.data.lastSeenMs,
            deviceId: parsed.data.deviceId,
            ip: parsed.data.ip,
            fw: parsed.data.fw,
          });
        }
        if (parsed.data.type === 'error') {
          if (parsed.data.message.includes(`Device heartbeat timed out for ${vehicleId}`)) {
            onDeviceStatus?.({ online: false, lastSeenMs: Date.now() });
          }
          onError?.(parsed.data.message);
        }
      } catch {
        return;
      }
    },
  });

  wsRef.current = reconnectRef.current;
  return { wsRef, isConnected };
}
