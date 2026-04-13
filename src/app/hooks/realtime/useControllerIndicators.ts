import { useEffect, useRef, useState } from 'react';

type PresenceLike = {
  deviceOnline?: boolean;
  gamepadConnected?: boolean;
  controlWsConnected?: boolean;
};

interface UseControllerIndicatorsOptions {
  presence: PresenceLike;
  isPresenceOwner: boolean;
  updatePresence: (patch: {
    deviceOnline?: boolean;
    gamepadConnected?: boolean;
    controlWsConnected?: boolean;
  }) => void;
  mirrorToPresence?: boolean;
  initialDeviceOnline?: boolean;
}

export function useControllerIndicators(options: UseControllerIndicatorsOptions) {
  const {
    presence,
    isPresenceOwner,
    updatePresence,
    mirrorToPresence = true,
    initialDeviceOnline = false,
  } = options;

  const [deviceOnline, setDeviceOnline] = useState(initialDeviceOnline);
  const [controllerInfo, setControllerInfo] = useState<{ id: string; mapping?: string; battery?: number | null }>({
    id: 'Unknown',
  });
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [hapticsSupported, setHapticsSupported] = useState<boolean | null>(null);
  const [syncedGamepadConnected, setSyncedGamepadConnected] = useState(false);
  const [syncedControlWsConnected, setSyncedControlWsConnected] = useState(false);
  const hapticsSupportedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (isPresenceOwner) return;
    if (presence.deviceOnline !== undefined && presence.deviceOnline !== deviceOnline) {
      setDeviceOnline(presence.deviceOnline);
    }
  }, [presence.deviceOnline, deviceOnline, isPresenceOwner]);

  useEffect(() => {
    if (!mirrorToPresence) return;
    updatePresence({ deviceOnline });
  }, [deviceOnline, mirrorToPresence, updatePresence]);

  useEffect(() => {
    const readControllerInfo = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = Array.from(pads).find((item): item is Gamepad => Boolean(item && item.connected)) || null;
      if (!pad) {
        setControllerInfo({ id: 'Unknown' });
        return;
      }
      const battery =
        typeof (pad as unknown as { battery?: { level?: number | null } }).battery?.level === 'number'
          ? (pad as unknown as { battery?: { level?: number | null } }).battery?.level ?? null
          : null;
      setControllerInfo({
        id: pad.id || 'Gamepad',
        mapping: pad.mapping,
        battery,
      });
    };

    readControllerInfo();
    const interval = window.setInterval(readControllerInfo, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isPresenceOwner) return;
    if (presence.gamepadConnected !== undefined) {
      setSyncedGamepadConnected(presence.gamepadConnected);
    }
  }, [presence.gamepadConnected, isPresenceOwner]);

  useEffect(() => {
    if (isPresenceOwner) return;
    if (presence.controlWsConnected !== undefined) {
      setSyncedControlWsConnected(presence.controlWsConnected);
    }
  }, [presence.controlWsConnected, isPresenceOwner]);

  return {
    deviceOnline,
    setDeviceOnline,
    controllerInfo,
    setControllerInfo,
    batteryLevel,
    setBatteryLevel,
    hapticsSupported,
    setHapticsSupported,
    hapticsSupportedRef,
    syncedGamepadConnected,
    setSyncedGamepadConnected,
    syncedControlWsConnected,
    setSyncedControlWsConnected,
  };
}
