import { useEffect, useRef } from 'react';
import { clientMessageSchema } from '@shared/protocol';
import type { MissionPlan, TelemetryPayload } from '@shared/types';

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
  onGamepadConnectionChange: (connected: boolean) => void;
  onEnqueueTelemetry: (payload: TelemetryPayload) => void;
  onRequestAutoMode: () => void;
  onCancelMissionPrompt: () => void;
  onConfirmMission: (mission: MissionPlan) => void;
  resolveSelectedMission: () => MissionPlan | null;
  setPendingMission: (mission: MissionPlan | null) => void;
  setMissionPrompt: (state: 'none' | 'select' | 'confirm') => void;
  setSelectedMissionId: (id: string | null) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeAxis = (value: number) => {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return clamp(num, -1, 1);
};
const normalizeButton = (value: number) => {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return clamp(num, 0, 1);
};
const ANALOG_EPS = 0.01;

const hasStateChanged = (prev: TelemetryPayload | null, next: TelemetryPayload) => {
  if (!prev) return true;
  if (prev.buttons.length !== next.buttons.length || prev.axes.length !== next.axes.length) {
    return true;
  }
  for (let i = 0; i < prev.buttons.length; i += 1) {
    if (Math.abs(prev.buttons[i] - next.buttons[i]) > ANALOG_EPS) return true;
  }
  for (let i = 0; i < prev.axes.length; i += 1) {
    if (Math.abs(prev.axes[i] - next.axes[i]) > ANALOG_EPS) return true;
  }
  return false;
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
    onGamepadConnectionChange,
    onEnqueueTelemetry,
    onRequestAutoMode,
    onCancelMissionPrompt,
    onConfirmMission,
    resolveSelectedMission,
    setPendingMission,
    setMissionPrompt,
    setSelectedMissionId,
  } = options;

  const animationFrameId = useRef<number>();
  const connectionRef = useRef(false);

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

      const pauseUntil = telemetryPauseUntilRef?.current ?? 0;
      if (Date.now() < pauseUntil) {
        prevModeButtonRef.current = modePressed;
        prevConfirmButtonRef.current = confirmPressed;
        prevCancelButtonRef.current = cancelPressed;
        animationFrameId.current = requestAnimationFrame(pollGamepad);
        return;
      }

      if (hasStateChanged(lastPayloadRef.current, payload)) {
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
        } else {
          const AUTO_HEARTBEAT_MS = 1000;
          const now = Date.now();
          if (now - lastAutoControlSentRef.current >= AUTO_HEARTBEAT_MS) {
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
      }

      if (modeRising) {
        if (driveModeRef.current === 'manual') {
          onRequestAutoMode();
        } else {
          onCancelMissionPrompt();
        }
      }

      if (confirmRising && missionPromptRef.current === 'confirm' && pendingMissionRef.current) {
        onConfirmMission(pendingMissionRef.current);
      }
      if (confirmRising && missionPromptRef.current === 'select') {
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
      if (cancelRising && missionPromptRef.current !== 'none') {
        onCancelMissionPrompt();
      }

      prevModeButtonRef.current = modePressed;
      prevConfirmButtonRef.current = confirmPressed;
      prevCancelButtonRef.current = cancelPressed;

      const dpadRight = buttons[15] > 0.5;
      const dpadLeft = buttons[14] > 0.5;
      const dpadDir = dpadRight ? 1 : dpadLeft ? -1 : 0;
      if (missionPromptRef.current !== 'none' && dpadDir !== 0) {
        const nowMs = Date.now();
        if (nowMs - lastMissionAxisSwitchRef.current > 250 && dpadDir !== prevMissionAxisRef.current) {
          const saved = missionsRef.current;
          const draft = draftMissionRef.current;
          const choices = [...(draft ? [draft] : []), ...saved];
          if (choices.length) {
            const currentId =
              selectedMissionIdRef.current ||
              (activeMissionIdRef.current &&
                choices.some((entry) => entry.id === activeMissionIdRef.current)
                ? activeMissionIdRef.current
                : '');
            const currentIndex = currentId ? choices.findIndex((entry) => entry.id === currentId) : -1;
            const nextIndex =
              currentIndex >= 0 ? (currentIndex + dpadDir + choices.length) % choices.length : 0;
            const nextMission = choices[nextIndex] || null;
            if (nextMission) {
              setSelectedMissionId(nextMission.id);
              setPendingMission(nextMission);
              setMissionPrompt('confirm');
            }
          }
          lastMissionAxisSwitchRef.current = nowMs;
          prevMissionAxisRef.current = dpadDir;
        }
      }
      if (dpadDir === 0) {
        prevMissionAxisRef.current = 0;
      }

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
    userId,
    vehicleId,
    controlWsRef,
    telemetryWsRef,
  ]);
}
