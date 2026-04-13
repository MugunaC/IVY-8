import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import type { CoopStatePayload, WsServerMessage } from '@shared/types';

type UseCoopSessionOptions = {
  wsRef: MutableRefObject<WebSocket | null>;
  isConnected: boolean;
  sessionId: string;
  vehicleId?: string;
  userId?: string;
  username?: string;
  spectator?: boolean;
};

const EMPTY_STATE: CoopStatePayload = {
  sessionId: '',
  invitePath: '',
  participants: [],
  vehicles: [],
  messages: [],
  sharedPlan: null,
};

export function useCoopSession(options: UseCoopSessionOptions) {
  const { wsRef, isConnected, sessionId, vehicleId, userId, username, spectator = false } = options;
  const [state, setState] = useState<CoopStatePayload>(EMPTY_STATE);

  useEffect(() => {
    if (!sessionId) {
      setState(EMPTY_STATE);
      return;
    }
    setState((prev) =>
      prev.sessionId === sessionId
        ? prev
        : { sessionId, invitePath: '', participants: [], vehicles: [], messages: [], sharedPlan: null }
    );
  }, [sessionId]);

  const send = useCallback((message: unknown) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, [wsRef]);

  useEffect(() => {
    if (!isConnected || !sessionId || !userId || !username) return;
    send({
      type: 'coop_join',
      sessionId,
      vehicleId,
      userId,
      username,
      role: spectator ? 'spectator' : 'driver',
    });
    return () => {
      send({
        type: 'coop_leave',
        sessionId,
        userId,
      });
    };
  }, [isConnected, send, sessionId, spectator, userId, username, vehicleId]);

  const handleServerMessage = useCallback((message: WsServerMessage) => {
    if (message.type === 'coop_state' && (!sessionId || message.payload.sessionId === sessionId)) {
      setState(message.payload);
      return;
    }
    if (message.type === 'coop_chat' && (!sessionId || message.payload.sessionId === sessionId)) {
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, message.payload].slice(-50),
      }));
    }
  }, [sessionId]);

  const sendChat = useCallback((text: string) => {
    if (!sessionId || !userId || !username) return false;
    return send({
      type: 'coop_chat',
      sessionId,
      vehicleId,
      userId,
      username,
      text,
    });
  }, [send, sessionId, userId, username, vehicleId]);

  const setSharedPlan = useCallback(
    (
      plan: {
        waypoints: Array<{ lat: number; lng: number; label?: string }>;
        route?: { type: 'LineString'; coordinates: [number, number][] } | null;
        distanceMeters?: number;
        etaSeconds?: number;
      }
    ) => {
      if (!sessionId || !userId || !username) return false;
      return send({
        type: 'coop_plan_set',
        sessionId,
        vehicleId,
        userId,
        username,
        waypoints: plan.waypoints,
        route: plan.route,
        distanceMeters: plan.distanceMeters,
        etaSeconds: plan.etaSeconds,
      });
    },
    [send, sessionId, userId, username, vehicleId]
  );

  const clearSharedPlan = useCallback(() => {
    if (!sessionId || !userId) return false;
    return send({
      type: 'coop_plan_clear',
      sessionId,
      userId,
    });
  }, [send, sessionId, userId]);

  return useMemo(
    () => ({
      coopState: state,
      handleServerMessage,
      sendChat,
      setSharedPlan,
      clearSharedPlan,
    }),
    [clearSharedPlan, handleServerMessage, sendChat, setSharedPlan, state]
  );
}
