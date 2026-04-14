import { useEffect, useRef } from 'react';
import { clientMessageSchema } from '@shared/protocol';
import type { MissionPlan, TelemetryPayload } from '@shared/types';
import { normalizeAxis, normalizeButton, hasStateChanged } from '@/app/components/realtime/control/controlMath';
import { readJson, removeKey, STORAGE_KEYS, writeJson } from '@/app/data/storage';

interface UseGamepadLoopOptions {
  vehicleId: string;
  userId?: string;
  controlWsRef: React.MutableRefObject<WebSocket | null>;
  telemetryWsRef: React.MutableRefObject<WebSocket | null>;
  controlLeaseIdRef: React.MutableRefObject<string | null>;
  driveModeRef: React.MutableRefObject<'manual' | 'auto'>;
  controlSeqRef: React.MutableRefObject<number>;
  lastAutoControlSentRef: React.MutableRefObject<number>;
  missionPromptRef: React.MutableRefObject<'none' | 'select' | 'confirm'>;
  pendingMissionRef: React.MutableRefObject<MissionPlan | null>;
  draftMissionRef: React.MutableRefObject<MissionPlan | null>;
  missionsRef: React.MutableRefObject<MissionPlan[]>;
  selectedMissionIdRef: React.MutableRefObject<string | null>;
  activeMissionIdRef: React.MutableRefObject<string | null>;
  prevModeButtonRef: React.MutableRefObject<boolean>;
  prevConfirmButtonRef: React.MutableRefObject<boolean>;
  prevCancelButtonRef: React.MutableRefObject<boolean>;
  prevMissionAxisRef: React.MutableRefObject<number>;
  lastMissionAxisSwitchRef: React.MutableRefObject<number>;
  telemetryCountRef: React.MutableRefObject<number>;
  lastPayloadRef: React.MutableRefObject<TelemetryPayload | null>;
  telemetryPauseUntilRef?: React.MutableRefObject<number>;
  inputBlockedRef?: React.MutableRefObject<boolean>;
  onGamepadConnectionChange: (connected: boolean) => void;
  onEnqueueTelemetry: (payload: TelemetryPayload) => void;
  onRequestAutoMode: () => void;
  onCancelMissionPrompt: () => void;
  onConfirmMission: (mission: MissionPlan) => void;
  resolveSelectedMission: () => MissionPlan | null;
  setPendingMission: (mission: MissionPlan | null) => void;
  setMissionPrompt: (state: 'none' | 'select' | 'confirm') => void;
  setSelectedMissionId: (id: string | null) => void;
  onGamepadSample?: (sample: { gamepad: Gamepad; buttons: number[]; axes: number[]; now: number }) => void;
  onLeaseMissing?: () => void;
}

const MANUAL_CONTROL_INTERVAL_MS = 50;
const AUTO_HEARTBEAT_MS = 1000;
const CONTROL_PUBLISHER_HEARTBEAT_MS = 150;
const CONTROL_PUBLISHER_STALE_MS = 500;

type ControlPublisherState = {
  tabId: string;
  ts: number;
};

export function useGamepadLoop(options: UseGamepadLoopOptions) {
  const {
    vehicleId,
    userId,
    controlWsRef,
    telemetryWsRef,
    controlLeaseIdRef,
    driveModeRef,
    controlSeqRef,
    lastAutoControlSentRef,
    missionPromptRef,
    pendingMissionRef,
    draftMissionRef,
    missionsRef,
    selectedMissionIdRef,
    activeMissionIdRef,
    prevModeButtonRef,
    prevConfirmButtonRef,
    prevCancelButtonRef,
    prevMissionAxisRef,
    lastMissionAxisSwitchRef,
    telemetryCountRef,
    lastPayloadRef,
    telemetryPauseUntilRef,
    inputBlockedRef,
    onGamepadConnectionChange,
    onEnqueueTelemetry,
    onRequestAutoMode,
    onCancelMissionPrompt,
    onConfirmMission,
    resolveSelectedMission,
    setPendingMission,
    setMissionPrompt,
    setSelectedMissionId,
    onGamepadSample,
    onLeaseMissing,
  } = options;

  const animationFrameId = useRef<number>();
  const connectionRef = useRef(false);
  const lastManualControlSentRef = useRef(0);
  const tabIdRef = useRef(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  );
  const isActivePublisherRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = STORAGE_KEYS.controlPublisher(vehicleId);
    const tabId = tabIdRef.current;
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(`ivy-control-publisher:${vehicleId}`)
        : null;

    const readPublisher = () => readJson<ControlPublisherState | null>(key, null);
    const shouldOwnPublisher = () => document.visibilityState === 'visible' && document.hasFocus();
    const syncPublisherRef = () => {
      const current = readPublisher();
      const now = Date.now();
      isActivePublisherRef.current = Boolean(
        current && current.tabId === tabId && now - current.ts <= CONTROL_PUBLISHER_STALE_MS
      );
    };
    const claimPublisher = () => {
      const next = { tabId, ts: Date.now() };
      writeJson(key, next);
      channel?.postMessage(next);
      isActivePublisherRef.current = true;
    };
    const releasePublisher = () => {
      const current = readPublisher();
      if (current?.tabId === tabId) {
        removeKey(key);
        channel?.postMessage({ tabId: '', ts: 0 });
      }
      isActivePublisherRef.current = false;
    };
    const updatePublisher = () => {
      const now = Date.now();
      const current = readPublisher();
      const currentIsFresh = Boolean(current && now - current.ts <= CONTROL_PUBLISHER_STALE_MS);
      if (shouldOwnPublisher()) {
        if (!currentIsFresh || current?.tabId !== tabId) {
          claimPublisher();
          return;
        }
        writeJson(key, { tabId, ts: now });
        channel?.postMessage({ tabId, ts: now });
        isActivePublisherRef.current = true;
        return;
      }
      if (current?.tabId === tabId) {
        releasePublisher();
        return;
      }
      syncPublisherRef();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      if (shouldOwnPublisher()) {
        updatePublisher();
        return;
      }
      syncPublisherRef();
    };
    const handleVisibilityChange = () => updatePublisher();
    const handleFocus = () => updatePublisher();
    const handleBlur = () => updatePublisher();
    const handlePageHide = () => releasePublisher();
    const handleChannel = () => {
      if (shouldOwnPublisher()) {
        updatePublisher();
        return;
      }
      syncPublisherRef();
    };

    channel?.addEventListener('message', handleChannel);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    updatePublisher();
    const heartbeat = window.setInterval(updatePublisher, CONTROL_PUBLISHER_HEARTBEAT_MS);

    return () => {
      window.clearInterval(heartbeat);
      releasePublisher();
      channel?.removeEventListener('message', handleChannel);
      channel?.close();
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [vehicleId]);

  useEffect(() => {
    const pollGamepad = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gamepad =
        Array.from(gamepads).find((pad): pad is Gamepad => Boolean(pad && pad.connected)) || null;

      if (!gamepad) {
        if (connectionRef.current) {
          connectionRef.current = false;
          onGamepadConnectionChange(false);
        }
        lastPayloadRef.current = null;
        lastManualControlSentRef.current = 0;
        animationFrameId.current = requestAnimationFrame(pollGamepad);
        return;
      }

      if (!connectionRef.current) {
        connectionRef.current = true;
        onGamepadConnectionChange(true);
      }

      const buttons = gamepad.buttons.map((button) =>
        normalizeButton(typeof button.value === 'number' ? button.value : button.pressed ? 1 : 0)
      );
      const axes = Array.from(gamepad.axes, (axis) => normalizeAxis(axis));
      const modePressed = buttons[9] > 0.5;
      const confirmPressed = buttons[0] > 0.5;
      const cancelPressed = buttons[1] > 0.5;
      const modeRising = modePressed && !prevModeButtonRef.current;
      const confirmRising = confirmPressed && !prevConfirmButtonRef.current;
      const cancelRising = cancelPressed && !prevCancelButtonRef.current;
      const payload: TelemetryPayload = {
        buttons,
        axes,
        vehicleId,
        leaseId: undefined,
      };
      const now = Date.now();

      const pauseUntil = telemetryPauseUntilRef?.current ?? 0;
      if (Date.now() < pauseUntil) {
        prevModeButtonRef.current = modePressed;
        prevConfirmButtonRef.current = confirmPressed;
        prevCancelButtonRef.current = cancelPressed;
        animationFrameId.current = requestAnimationFrame(pollGamepad);
        return;
      }

      onGamepadSample?.({ gamepad, buttons, axes, now });

      const inputBlocked = inputBlockedRef?.current ?? false;
      const stateChanged = hasStateChanged(lastPayloadRef.current, payload);
      const canPublish = !inputBlocked && isActivePublisherRef.current;

      if (canPublish && stateChanged) {
        const nextSeq = telemetryCountRef.current + 1;
        const payloadWithSeq: TelemetryPayload = { ...payload, seq: nextSeq };
        lastPayloadRef.current = payload;
        telemetryCountRef.current = nextSeq;
        onEnqueueTelemetry(payloadWithSeq);
        const message = clientMessageSchema.safeParse({
          type: 'input',
          payload: payloadWithSeq,
          vehicleId,
        });
        const inputSocket = telemetryWsRef.current || controlWsRef.current;
        if (message.success && inputSocket?.readyState === WebSocket.OPEN) {
          inputSocket.send(JSON.stringify(message.data));
        }
      }

      const activeLeaseId = controlLeaseIdRef.current;
      if (activeLeaseId && controlWsRef.current?.readyState === WebSocket.OPEN) {
        const activeMode = driveModeRef.current;
        if (activeMode === 'manual') {
          if (canPublish && (stateChanged || now - lastManualControlSentRef.current >= MANUAL_CONTROL_INTERVAL_MS)) {
            lastManualControlSentRef.current = now;
            const message = clientMessageSchema.safeParse({
              type: 'control',
              vehicleId,
              payload: {
                seq: controlSeqRef.current++,
                leaseId: activeLeaseId,
                buttons,
                axes,
                mode: 'manual',
              },
            });
            if (message.success) {
              controlWsRef.current.send(JSON.stringify(message.data));
            }
          }
        } else {
          if (canPublish && now - lastAutoControlSentRef.current >= AUTO_HEARTBEAT_MS) {
            lastAutoControlSentRef.current = now;
            const message = clientMessageSchema.safeParse({
              type: 'control',
              vehicleId,
              payload: {
                seq: controlSeqRef.current++,
                leaseId: activeLeaseId,
                buttons,
                axes,
                mode: 'auto',
              },
            });
            if (message.success) {
              controlWsRef.current.send(JSON.stringify(message.data));
            }
          }
        }
      } else if (!activeLeaseId && stateChanged) {
        onLeaseMissing?.();
      }

      if (canPublish && modeRising) {
        if (driveModeRef.current === 'manual') {
          onRequestAutoMode();
        } else {
          onCancelMissionPrompt();
        }
      }

      if (canPublish && confirmRising && missionPromptRef.current === 'confirm' && pendingMissionRef.current) {
        onConfirmMission(pendingMissionRef.current);
      }
      if (canPublish && confirmRising && missionPromptRef.current === 'select') {
        const selected =
          (draftMissionRef.current && selectedMissionIdRef.current === draftMissionRef.current.id
            ? draftMissionRef.current
            : null) || resolveSelectedMission();
        if (selected) {
          setPendingMission(selected);
          setMissionPrompt('confirm');
        } else {
          setMissionPrompt('select');
        }
      }
      if (canPublish && cancelRising && missionPromptRef.current !== 'none') {
        onCancelMissionPrompt();
      }

      prevModeButtonRef.current = modePressed;
      prevConfirmButtonRef.current = confirmPressed;
      prevCancelButtonRef.current = cancelPressed;

      animationFrameId.current = requestAnimationFrame(pollGamepad);
    };

    animationFrameId.current = requestAnimationFrame(pollGamepad);
    const handleGamepadConnected = () => onGamepadConnectionChange(true);
    const handleGamepadDisconnected = () => {
      const anyConnected = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).some(
        (pad) => !!pad && pad.connected
      );
      onGamepadConnectionChange(anyConnected);
    };
    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
    };
  }, [
    activeMissionIdRef,
    controlLeaseIdRef,
    controlSeqRef,
    driveModeRef,
    draftMissionRef,
    lastAutoControlSentRef,
    lastMissionAxisSwitchRef,
    lastPayloadRef,
    missionPromptRef,
    missionsRef,
    onCancelMissionPrompt,
    onConfirmMission,
    onEnqueueTelemetry,
    onGamepadConnectionChange,
    onRequestAutoMode,
    pendingMissionRef,
    prevCancelButtonRef,
    prevConfirmButtonRef,
    prevMissionAxisRef,
    prevModeButtonRef,
    resolveSelectedMission,
    selectedMissionIdRef,
    setMissionPrompt,
    setPendingMission,
    setSelectedMissionId,
    telemetryCountRef,
    telemetryPauseUntilRef,
    inputBlockedRef,
    userId,
    vehicleId,
    controlWsRef,
    telemetryWsRef,
    onGamepadSample,
    onLeaseMissing,
  ]);
}
