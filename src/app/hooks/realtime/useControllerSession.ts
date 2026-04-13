import { useEffect, useRef, useState } from 'react';
import { getVehicles, markVehicleInUse } from '@/app/data/vehiclesRepo';
import type { MissionPlan, Vehicle } from '@shared/types';

type PresenceLike = {
  driveMode?: 'manual' | 'auto';
  controlLeaseId?: string | null;
};

interface UseControllerSessionOptions {
  vehicleId: string;
  user?: { id: string; username: string } | null;
  isSpectatorSession?: boolean;
  isPresenceOwner: boolean;
  presence: PresenceLike;
  updatePresence: (patch: { driveMode?: 'manual' | 'auto'; controlLeaseId?: string | null }) => void;
  initialDriveMode?: 'manual' | 'auto';
  initialControlLeaseId?: string | null;
  initialSelectedMissionId?: string | null;
  onVehicleHydrated?: (vehicle: Vehicle | null) => void;
}

export function useControllerSession(options: UseControllerSessionOptions) {
  const {
    vehicleId,
    user,
    isSpectatorSession = false,
    isPresenceOwner,
    presence,
    updatePresence,
    initialDriveMode = 'manual',
    initialControlLeaseId = null,
    initialSelectedMissionId = null,
    onVehicleHydrated,
  } = options;

  const [driveMode, setDriveMode] = useState<'manual' | 'auto'>(presence.driveMode || initialDriveMode);
  const [controlLeaseId, setControlLeaseId] = useState<string | null>(presence.controlLeaseId ?? initialControlLeaseId);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(initialSelectedMissionId);
  const [pendingMission, setPendingMission] = useState<MissionPlan | null>(null);
  const [missionPrompt, setMissionPrompt] = useState<'none' | 'select' | 'confirm'>('none');
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);

  const driveModeRef = useRef<'manual' | 'auto'>(driveMode);
  const missionPromptRef = useRef<'none' | 'select' | 'confirm'>(missionPrompt);
  const pendingMissionRef = useRef<MissionPlan | null>(pendingMission);
  const selectedMissionIdRef = useRef<string | null>(selectedMissionId);
  const activeMissionIdRef = useRef<string | null>(activeMissionId);
  const draftMissionRef = useRef<MissionPlan | null>(null);
  const controlSeqRef = useRef(0);
  const lastAutoControlSentRef = useRef(0);
  const controlLeaseIdRef = useRef<string | null>(controlLeaseId);

  useEffect(() => {
    driveModeRef.current = driveMode;
    updatePresence({ driveMode });
  }, [driveMode, updatePresence]);

  useEffect(() => {
    if (isPresenceOwner) return;
    if (presence.driveMode && presence.driveMode !== driveMode) {
      setDriveMode(presence.driveMode);
    }
  }, [presence.driveMode, driveMode, isPresenceOwner]);

  useEffect(() => {
    controlLeaseIdRef.current = controlLeaseId;
    updatePresence({ controlLeaseId });
  }, [controlLeaseId, updatePresence]);

  useEffect(() => {
    if (isPresenceOwner) return;
    if (presence.controlLeaseId !== undefined && presence.controlLeaseId !== controlLeaseId) {
      setControlLeaseId(presence.controlLeaseId ?? null);
    }
  }, [presence.controlLeaseId, controlLeaseId, isPresenceOwner]);

  useEffect(() => {
    missionPromptRef.current = missionPrompt;
  }, [missionPrompt]);

  useEffect(() => {
    pendingMissionRef.current = pendingMission;
  }, [pendingMission]);

  useEffect(() => {
    selectedMissionIdRef.current = selectedMissionId;
  }, [selectedMissionId]);

  useEffect(() => {
    activeMissionIdRef.current = activeMissionId;
  }, [activeMissionId]);

  useEffect(() => {
    if (!vehicleId || !user || isSpectatorSession) return;
    let cancelled = false;

    const hydrateLease = async () => {
      try {
        const vehicles = await getVehicles();
        const match = vehicles.find((item) => item.id === vehicleId) ?? null;
        if (cancelled) return;
        onVehicleHydrated?.(match);
        setControlLeaseId(match?.controlLeaseId ?? null);

        if (!match?.controlLeaseId) {
          const updated = await markVehicleInUse(vehicleId, user.username, user.id);
          if (cancelled) return;
          const next = updated.find((item) => item.id === vehicleId) ?? null;
          onVehicleHydrated?.(next);
          setControlLeaseId(next?.controlLeaseId ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to hydrate control lease:', error);
        }
      }
    };

    void hydrateLease();
    return () => {
      cancelled = true;
    };
  }, [isSpectatorSession, onVehicleHydrated, user, vehicleId]);

  return {
    driveMode,
    setDriveMode,
    controlLeaseId,
    setControlLeaseId,
    selectedMissionId,
    setSelectedMissionId,
    pendingMission,
    setPendingMission,
    missionPrompt,
    setMissionPrompt,
    activeMissionId,
    setActiveMissionId,
    driveModeRef,
    missionPromptRef,
    pendingMissionRef,
    selectedMissionIdRef,
    activeMissionIdRef,
    draftMissionRef,
    controlSeqRef,
    lastAutoControlSentRef,
    controlLeaseIdRef,
  };
}
