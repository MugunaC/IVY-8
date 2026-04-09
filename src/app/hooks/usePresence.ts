import { useCallback, useEffect, useRef, useState } from 'react';
import {
  claimPresenceOwner,
  getPresence,
  setPresenceIfOwner,
  subscribePresence,
  type PresenceEntry,
} from '@/app/data/presenceStore';

function createOwnerId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `presence-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

export function usePresence(vehicleId: string) {
  const [presence, setPresenceState] = useState<PresenceEntry>(() => getPresence(vehicleId));
  const ownerIdRef = useRef<string>(createOwnerId());
  const ownerActiveRef = useRef(false);
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    setPresenceState(getPresence(vehicleId));
    return subscribePresence(vehicleId, (next) => {
      if (ownerActiveRef.current) return;
      setPresenceState(next);
    });
  }, [vehicleId]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') {
        ownerActiveRef.current = false;
        setIsOwner(false);
        return;
      }
      const claimed = claimPresenceOwner(vehicleId, ownerIdRef.current);
      ownerActiveRef.current = claimed;
      setIsOwner(claimed);
    };
    tick();
    const timer = window.setInterval(tick, 2000);
    const handleVisibility = () => tick();
    window.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [vehicleId]);

  const updatePresence = useCallback(
    (updates: PresenceEntry) => {
      if (!ownerActiveRef.current) return presence;
      const next = setPresenceIfOwner(vehicleId, ownerIdRef.current, updates);
      setPresenceState(next);
      return next;
    },
    [presence, vehicleId]
  );

  return { presence, updatePresence, isOwner };
}
