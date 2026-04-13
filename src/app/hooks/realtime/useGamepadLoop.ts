import { useEffect, useRef } from 'react';
import { clientMessageSchema } from '@shared/protocol';
import type { MissionPlan, TelemetryPayload } from '@shared/types';
import { normalizeAxis, normalizeButton, hasStateChanged } from '@/app/components/realtime/control/controlMath';

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

      if (!inputBlocked && stateChanged) {
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
          if (!inputBlocked && (stateChanged || now - lastManualControlSentRef.current >= MANUAL_CONTROL_INTERVAL_MS)) {
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
          if (!inputBlocked && now - lastAutoControlSentRef.current >= AUTO_HEARTBEAT_MS) {
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
