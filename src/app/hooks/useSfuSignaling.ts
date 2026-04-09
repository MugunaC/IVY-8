import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JoinViewerMessage, RequestMessage, ResponseMessage } from '@shared/sfu';

export type SignalingPayload = Record<string, unknown>;

interface PendingRequest {
  resolve: (value: SignalingPayload) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
}

interface UseSfuSignalingOptions {
  url: string;
  roomId: string;
  viewerId: string;
  token?: string;
  timeoutMs?: number;
}

interface SignalingState {
  isConnected: boolean;
  lastError: string | null;
}

function createRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useSfuSignaling(options: UseSfuSignalingOptions) {
  const { url, roomId, viewerId, token, timeoutMs = 10_000 } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const [state, setState] = useState<SignalingState>({
    isConnected: false,
    lastError: null,
  });

  const clearPending = useCallback((reason: string) => {
    pendingRef.current.forEach((pending) => {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error(reason));
    });
    pendingRef.current.clear();
  }, []);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState({ isConnected: true, lastError: null });
      const joinMessage: JoinViewerMessage = {
        type: 'join',
        role: 'viewer',
        roomId,
        viewerId,
        token,
      };
      ws.send(JSON.stringify(joinMessage));
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const parsed = JSON.parse(event.data) as Partial<ResponseMessage<SignalingPayload>>;

        if (parsed.requestId && pendingRef.current.has(parsed.requestId)) {
          const pending = pendingRef.current.get(parsed.requestId)!;
          pendingRef.current.delete(parsed.requestId);
          window.clearTimeout(pending.timeoutId);
          if (parsed.error) {
            pending.reject(new Error(parsed.error));
            return;
          }
          pending.resolve(parsed.payload || {});
        }
      } catch {
        setState((prev) => ({ ...prev, lastError: 'Invalid signaling message' }));
      }
    };

    ws.onerror = () => {
      setState((prev) => ({ ...prev, lastError: 'Signaling socket error' }));
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, isConnected: false }));
      clearPending('Signaling disconnected');
    };

    return () => {
      clearPending('Signaling closed');
      ws.close();
      wsRef.current = null;
    };
  }, [clearPending, roomId, token, url, viewerId]);

  const request = useCallback(
    (type: string, payload: SignalingPayload = {}) =>
      new Promise<SignalingPayload>((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Signaling socket not connected'));
          return;
        }

        const requestId = createRequestId();
        const timeoutId = window.setTimeout(() => {
          pendingRef.current.delete(requestId);
          reject(new Error(`Signaling timeout for ${type}`));
        }, timeoutMs);

        pendingRef.current.set(requestId, { resolve, reject, timeoutId });
        const message: RequestMessage<SignalingPayload> = {
          type,
          requestId,
          roomId,
          viewerId,
          payload,
        };
        ws.send(JSON.stringify(message));
      }),
    [roomId, timeoutMs, viewerId]
  );

  return useMemo(
    () => ({
      isConnected: state.isConnected,
      lastError: state.lastError,
      request,
    }),
    [request, state.isConnected, state.lastError]
  );
}
