import { useCallback, useEffect, useRef, useState } from 'react';
import { isPerfEnabled } from '@/app/utils/perf';

type UseReconnectingWebSocketOptions = {
  url: string;
  onOpen?: (ws: WebSocket) => void;
  onClose?: () => void;
  onError?: (message: string) => void;
  onMessage?: (event: MessageEvent) => void;
  shouldReconnect?: boolean;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  jitterRatio?: number;
};

export function useReconnectingWebSocket(options: UseReconnectingWebSocketOptions) {
  const {
    url,
    onOpen,
    onClose,
    onError,
    onMessage,
    shouldReconnect = true,
    backoffBaseMs = 500,
    backoffMaxMs = 10_000,
    jitterRatio = 0.2,
  } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const reconnectsRef = useRef(0);
  const connectStartRef = useRef(0);
  const connectRef = useRef<(() => void) | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const onOpenRef = useRef<UseReconnectingWebSocketOptions['onOpen']>();
  const onCloseRef = useRef<UseReconnectingWebSocketOptions['onClose']>();
  const onErrorRef = useRef<UseReconnectingWebSocketOptions['onError']>();
  const onMessageRef = useRef<UseReconnectingWebSocketOptions['onMessage']>();

  useEffect(() => {
    onOpenRef.current = onOpen;
    onCloseRef.current = onClose;
    onErrorRef.current = onError;
    onMessageRef.current = onMessage;
  }, [onOpen, onClose, onError, onMessage]);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnect) return;
    clearReconnectTimer();
    const attempt = attemptRef.current++;
    const base = Math.min(backoffMaxMs, backoffBaseMs * Math.pow(2, attempt));
    const jitter = base * jitterRatio;
    const delay = Math.max(0, base + (Math.random() * 2 - 1) * jitter);
    if (isPerfEnabled()) {
      console.info(`[Perf][ws] reconnect scheduled in ${Math.round(delay)}ms url=${url}`);
    }
    reconnectTimerRef.current = window.setTimeout(() => {
      connectRef.current?.();
    }, delay);
  }, [backoffBaseMs, backoffMaxMs, jitterRatio, shouldReconnect, url]);

  const connect = useCallback(() => {
    clearReconnectTimer();
    try {
      connectStartRef.current = performance.now();
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        attemptRef.current = 0;
        if (reconnectsRef.current > 0) reconnectsRef.current = 0;
        setIsConnected(true);
        if (isPerfEnabled()) {
          const elapsed = performance.now() - connectStartRef.current;
          console.info(`[Perf][ws] connected in ${elapsed.toFixed(1)}ms url=${url}`);
        }
        onOpenRef.current?.(ws);
      };
      ws.onmessage = (event) => {
        onMessageRef.current?.(event);
      };
      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        onCloseRef.current?.();
        reconnectsRef.current += 1;
        scheduleReconnect();
      };
      ws.onerror = () => {
        setIsConnected(false);
        wsRef.current = null;
        onErrorRef.current?.('WebSocket error');
      };
    } catch {
      setIsConnected(false);
      wsRef.current = null;
      onErrorRef.current?.('WebSocket error');
      reconnectsRef.current += 1;
      scheduleReconnect();
    }
  }, [scheduleReconnect, url]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      clearReconnectTimer();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return { wsRef, isConnected };
}
