import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '@/app/context/AuthContext';
import { useVehicleLocationFeed } from '@/app/hooks/useVehicleLocationFeed';
import { usePresence } from '@/app/hooks/usePresence';
import { useCoopSession } from '@/app/hooks/useCoopSession';
import { useControllerIndicators } from '@/app/hooks/realtime/useControllerIndicators';
import { useControllerSession } from '@/app/hooks/realtime/useControllerSession';
import { useControlSocket } from '@/app/hooks/realtime/useControlSocket';
import { useFocusMapRoutingWeather } from '@/app/hooks/realtime/useFocusMapRoutingWeather';
import { useGamepadLoop } from '@/app/hooks/realtime/useGamepadLoop';
import { useTelemetrySocket } from '@/app/hooks/realtime/useTelemetrySocket';
import { useDebouncedValue } from '@/app/hooks/useDebouncedValue';
import { enqueueTelemetry } from '@/app/data/inputStore';
import { readJson, readString, removeKey, STORAGE_KEYS, writeJson, writeString } from '@/app/data/storage';
import { registerSecondaryWindow } from '@/app/utils/secondaryWindows';
import { isPerfEnabled } from '@/app/utils/perf';
import {
  getDefaultControlWsUrl,
  getDefaultLocationWsUrl,
  getDefaultSignalingUrl,
  getDefaultTelemetryWsUrl,
} from '@/app/utils/wsUrls';
import {
  createMission,
  deleteMission,
  getMissionRoute,
  getMissions,
  updateMissionRoute,
  updateMission,
} from '@/app/data/missionsRepo';
import { clientMessageSchema } from '@shared/protocol';
import type { MissionPathType, MissionPlan, MissionWaypoint, TelemetryPayload, Vehicle, WsServerMessage } from '@shared/types';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Layers,
  Plus,
  RotateCcw,
  Trash2,
  SlidersHorizontal,
  Minimize2,
  Maximize2,
  Shuffle,
  Wifi,
  X,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { OverlayModal } from '@/app/components/ui/overlay-modal';
import { CoopChatDock } from '@/app/components/realtime/CoopChatDock';
import { RealtimeIndicatorsRow } from '@/app/components/realtime/control/RealtimeIndicatorsRow';
import { FocusMapFloatingControls } from '@/app/components/realtime/focus/FocusMapFloatingControls';
import { FocusMapMissionOverlay } from '@/app/components/realtime/focus/FocusMapMissionOverlay';
import { FocusMapSearchOverlay } from '@/app/components/realtime/focus/FocusMapSearchOverlay';
import { FocusMapStatusBar } from '@/app/components/realtime/focus/FocusMapStatusBar';
import {
  computeRouteDistance,
  formatCoordValue,
  formatEta,
  formatMeters,
  formatStepInstruction,
  formatWaypointPreview,
  haversineDistance,
  headingToCompass,
  type InstructionLocale,
  MAP_THEMES,
  resolveInstructionLocale,
  round,
} from '@/app/components/realtime/focus/focusMapUtils';
import { MissionPlannerTabs } from '@/app/components/realtime/MissionPlannerTabs';
import {
  buildMissionPayloadFromPlan,
  resolveLatestMission,
} from '@/app/components/realtime/missionUtils';
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp';

const MapPanel = lazy(async () => {
  const mod = await import('@/app/components/realtime/MapPanel');
  return { default: mod.MapPanel };
});

const VideoPanel = lazy(async () => {
  const mod = await import('@/app/components/realtime/VideoPanel');
  return { default: mod.VideoPanel };
});

const VISUALIZER_MIN_HEIGHT = 380;
function OpsPanelFallback(props: { title: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{props.title}</h3>
        <span className="text-xs text-muted-foreground">Loading</span>
      </header>
      <div className="h-56 w-full animate-pulse rounded-lg bg-muted/60" />
    </section>
  );
}

export function FocusMapView() {
  const perfEnabled = useMemo(() => isPerfEnabled(), []);
  const renderStart = perfEnabled ? performance.now() : 0;
  const { user } = useAuth();
  const location = useLocation();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const viewerId = user?.id || 'anon-viewer';
  const vehicleIdFromQuery = query.get('vehicleId');
  const vehicleIdFromState =
    typeof location.state?.vehicleId === 'string' ? location.state.vehicleId : null;
  const vehicleId = vehicleIdFromQuery || vehicleIdFromState || 'VH-001';
  const sessionId = query.get('session') || '';
  const isSpectatorSession = query.get('spectator') === '1';
  const focus = query.get('focus');
  const isFocusVideo = focus === 'video';
  const isFocusMap = focus === 'map';
  const isFocusControl = focus === 'control';
  const isFocusedDisplay = isFocusVideo || isFocusMap || isFocusControl;
  const roomId = useMemo(() => `vehicle-room-${vehicleId}`, [vehicleId]);
  const instructionLocale = useMemo(resolveInstructionLocale, []);
  const { presence, updatePresence, isOwner: isPresenceOwner } = usePresence(vehicleId);

  const locationFeed = useVehicleLocationFeed({
    wsUrl: getDefaultLocationWsUrl(),
    vehicleId,
  });
  const [isGamepadConnected, setIsGamepadConnected] = useState(false);
  const [telemetryCount, setTelemetryCount] = useState(0);
  const [syncedTelemetryCount, setSyncedTelemetryCount] = useState(0);
  const debouncedTelemetryCount = useDebouncedValue(telemetryCount, 750);
  const [visualizerHeight, setVisualizerHeight] = useState(700);
  const [visualizerMaxHeight, setVisualizerMaxHeight] = useState(700);
  const [mapThemeKey, setMapThemeKey] = useState('topo');
  const [mapThemesOpen, setMapThemesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [missionOverlayOpen, setMissionOverlayOpen] = useState(false);
  const [showMissionPlanner, setShowMissionPlanner] = useState(false);
  const [searchActionsOpen, setSearchActionsOpen] = useState(false);
  const [plannerMounted, setPlannerMounted] = useState(false);
  const [tbtDismissed, setTbtDismissed] = useState(false);
  const [tbtMinimized, setTbtMinimized] = useState(false);
  const [tbtOpacity, setTbtOpacity] = useState(0.85);
  const [tbtRouteMenuOpen, setTbtRouteMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [searchFocus, setSearchFocus] = useState<{ center: [number, number]; zoom?: number; signal: number } | null>(null);
  const [lastSearchRegionName, setLastSearchRegionName] = useState('');
  const [lastSearchCoords, setLastSearchCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [savePromptName, setSavePromptName] = useState('');
  const [planningEnabled, setPlanningEnabled] = useState(true);
  const [followVehicleMap, setFollowVehicleMap] = useState(!isFocusMap);
  const [missionWaypoints, setMissionWaypoints] = useState<MissionWaypoint[]>([]);
  const [missionPathType, setMissionPathType] = useState<MissionPathType>('roads');
  const [missionSpeedMps, setMissionSpeedMps] = useState(2);
  const [missionProfile, setMissionProfile] = useState<'rover' | 'drone'>('rover');
  const [arrivalRadiusM, setArrivalRadiusM] = useState(2);
  const [loiterSeconds, setLoiterSeconds] = useState(0);
  const [cruiseAltitudeM, setCruiseAltitudeM] = useState(10);
  const [missionRoute, setMissionRoute] = useState<{ type: 'LineString'; coordinates: [number, number][] } | null>(
    null
  );
  const [routeFocusSignal, setRouteFocusSignal] = useState(0);
  const [missionDistance, setMissionDistance] = useState(0);
  const [missionEta, setMissionEta] = useState(0);
  const [missions, setMissions] = useState<MissionPlan[]>([]);
  const [missionName, setMissionName] = useState('New Mission');
  const [draftMission, setDraftMission] = useState<MissionPlan | null>(null);
  const [missionActionFocus, setMissionActionFocus] = useState<'confirm' | 'cancel'>('confirm');
  const [missionSaveStatus, setMissionSaveStatus] = useState<string | null>(null);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [deviceStatus, setDeviceStatus] = useState<{
    online: boolean;
    lastSeenMs: number;
    deviceId?: string;
    ip?: string;
    fw?: string;
  }>({ online: false, lastSeenMs: 0 });
  const [deviceOverlayOpen, setDeviceOverlayOpen] = useState(false);
  const [controllerOverlayOpen, setControllerOverlayOpen] = useState(false);
  const [vehicleInfo, setVehicleInfo] = useState<Vehicle | null>(null);
  const lastPayloadRef = useRef<TelemetryPayload | null>(null);
  const telemetryCountRef = useRef(0);
  const visualizerRef = useRef<HTMLIFrameElement | null>(null);
  const visualizerContainerRef = useRef<HTMLDivElement | null>(null);
  const maxVisualizerHeightRef = useRef(0);
  const telemetryPauseUntilRef = useRef(0);
  const controlWsUrl = useMemo(() => getDefaultControlWsUrl({ includeOverride: true }), []);
  const telemetryWsUrl = useMemo(() => getDefaultTelemetryWsUrl(controlWsUrl), [controlWsUrl]);
  const coopHandlerRef = useRef<(message: WsServerMessage) => void>(() => {});
  const handleDeviceStatus = useCallback(
    (status: { online: boolean; lastSeenMs: number; deviceId?: string; ip?: string; fw?: string }) => {
      setDeviceStatus(status);
      if (!isFocusedDisplay) {
        setDeviceOnline(status.online);
      }
    },
    [isFocusedDisplay]
  );
  const { wsRef, isConnected: isControlWsConnected } = useControlSocket({
    url: controlWsUrl,
    vehicleId,
    onDeviceStatus: handleDeviceStatus,
    onError: (message) => {
      console.warn('Control WS error:', message);
    },
    onServerMessage: (message) => {
      coopHandlerRef.current(message);
    },
  });
  const { coopState, handleServerMessage, sendChat, clearRoute } = useCoopSession({
    wsRef,
    isConnected: isControlWsConnected,
    sessionId,
    vehicleId: isSpectatorSession ? undefined : vehicleId,
    userId: user?.id,
    username: user?.username,
    spectator: isSpectatorSession,
  });
  useEffect(() => {
    coopHandlerRef.current = handleServerMessage;
  }, [handleServerMessage]);
  const { wsRef: telemetryWsRef, isConnected: isTelemetryWsConnected } = useTelemetrySocket({
    url: telemetryWsUrl,
    vehicleId,
    onError: (message) => {
      console.warn('Telemetry WS error:', message);
    },
    onServerMessage: (message) => {
      if (message.type === 'slow_down') {
        telemetryPauseUntilRef.current = Date.now() + message.retryAfterMs;
      }
    },
  });
  const {
    driveMode,
    setDriveMode,
    controlLeaseId,
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
  } = useControllerSession({
    vehicleId,
    user,
    isSpectatorSession,
    isPresenceOwner,
    presence,
    updatePresence,
    initialDriveMode: presence.driveMode || 'manual',
    initialControlLeaseId: presence.controlLeaseId ?? null,
    onVehicleHydrated: setVehicleInfo,
  });
  const {
    deviceOnline,
    setDeviceOnline,
    controllerInfo,
    setSyncedGamepadConnected,
    syncedGamepadConnected,
    setSyncedControlWsConnected,
    syncedControlWsConnected,
  } = useControllerIndicators({
    presence,
    isPresenceOwner,
    updatePresence,
    mirrorToPresence: true,
  });
  const prevModeButtonRef = useRef(false);
  const prevConfirmButtonRef = useRef(false);
  const prevCancelButtonRef = useRef(false);
  const prevMissionAxisRef = useRef(0);
  const lastMissionAxisSwitchRef = useRef(0);
  const missionsRef = useRef<MissionPlan[]>([]);

  const triggerRouteFocus = useCallback(() => {
    if (isFocusMap) {
      setFollowVehicleMap(false);
    }
    setRouteFocusSignal((prev) => prev + 1);
  }, [isFocusMap]);

  const debouncedWaypoints = useDebouncedValue(missionWaypoints, 250);
  const debouncedPathType = useDebouncedValue(missionPathType, 250);
  const debouncedProfile = useDebouncedValue(missionProfile, 250);
  const debouncedSpeed = useDebouncedValue(missionSpeedMps, 250);
  const {
    routeAlternatives,
    setRouteAlternatives,
    selectedRouteIndex,
    setSelectedRouteIndex,
    selectedRouteIndexRef,
    routeSteps,
    setRouteSteps,
    hoveredRouteIndex,
    setHoveredRouteIndex,
    routingStatus,
    weatherStatusLabel,
    weatherIcon,
    handleSelectRoute,
  } = useFocusMapRoutingWeather({
    waypoints: debouncedWaypoints,
    pathType: debouncedPathType,
    profile: debouncedProfile,
    speedMps: debouncedSpeed,
    latestLocation: locationFeed.latest,
    onRouteResolved: (route, distance, eta) => {
      setMissionRoute(route);
      setMissionDistance(distance);
      setMissionEta(eta);
    },
    onRouteFocus: triggerRouteFocus,
  });
  const mapRouteAlternatives = useMemo(
    () =>
      routeAlternatives.map((entry) => ({
        type: 'LineString' as const,
        coordinates: entry.coordinates,
      })),
    [routeAlternatives]
  );

  useEffect(() => {
    const flush = window.setInterval(() => {
      setTelemetryCount((prev) => (prev === telemetryCountRef.current ? prev : telemetryCountRef.current));
    }, 250);
    return () => window.clearInterval(flush);
  }, []);

  const parseLatLng = useCallback((input: string) => {
    const cleaned = input.trim();
    if (!cleaned) return null;
    const parts = cleaned.split(/[,\s]+/).filter(Boolean);
    if (parts.length < 2) return null;
    const first = Number(parts[0]);
    const second = Number(parts[1]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    const aLat = Math.abs(first) <= 90 && Math.abs(second) <= 180;
    const bLat = Math.abs(second) <= 90 && Math.abs(first) <= 180;
    if (aLat) return { lat: first, lng: second };
    if (bLat) return { lat: second, lng: first };
    return null;
  }, []);

  const handleSearchSubmit = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    setSearchStatus(null);
    const coords = parseLatLng(query);
    if (coords) {
      const label = `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
      setFollowVehicleMap(false);
      setSearchFocus({ center: [coords.lng, coords.lat], zoom: 14, signal: Date.now() });
      setLastSearchRegionName(label);
      setLastSearchCoords(coords);
      writeString(STORAGE_KEYS.mapSearchRegion(vehicleId), label);
      return;
    }
    try {
      setSearchStatus('Searching...');
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Search failed (${response.status})`);
      }
      const results = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (!results.length) {
        setSearchStatus('No results found.');
        return;
      }
      const first = results[0];
      const lat = Number(first.lat);
      const lng = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setSearchStatus('Invalid result coordinates.');
        return;
      }
      const label = first.display_name || query;
      setFollowVehicleMap(false);
      setSearchFocus({ center: [lng, lat], zoom: 13, signal: Date.now() });
      setLastSearchRegionName(label);
      setLastSearchCoords({ lat, lng });
      writeString(STORAGE_KEYS.mapSearchRegion(vehicleId), label);
      setSearchStatus(null);
    } catch (error) {
      setSearchStatus(error instanceof Error ? error.message : 'Search failed.');
    }
  }, [parseLatLng, searchQuery, vehicleId]);

  const handleAddSearchWaypoint = useCallback(() => {
    if (!lastSearchCoords) return;
    if (!planningEnabled) {
      setPlanningEnabled(true);
    }
    setMissionWaypoints((prev) => [...prev, { lat: lastSearchCoords.lat, lng: lastSearchCoords.lng }]);
    triggerRouteFocus();
  }, [lastSearchCoords, planningEnabled, setPlanningEnabled, triggerRouteFocus]);

  useEffect(() => {
    if (showMissionPlanner && !plannerMounted) {
      setPlannerMounted(true);
    }
  }, [showMissionPlanner, plannerMounted]);

  useEffect(() => {
    if (!missionRoute?.coordinates?.length || !routeSteps.length) return;
    setTbtDismissed(false);
    setTbtMinimized(false);
    setTbtRouteMenuOpen(false);
  }, [missionRoute?.coordinates?.length, routeSteps.length, selectedRouteIndex]);

  const handleToggleOpacity = useCallback(() => {
    const presets = [0.6, 0.8, 1];
    const index = presets.indexOf(tbtOpacity);
    const next = presets[(index + 1) % presets.length] ?? 0.85;
    setTbtOpacity(next);
  }, [tbtOpacity]);

  useEffect(() => {
    if (!isFocusedDisplay) {
      updatePresence({ gamepadConnected: isGamepadConnected });
      setSyncedGamepadConnected(isGamepadConnected);
    }
  }, [isGamepadConnected, isFocusedDisplay, updatePresence]);

  useEffect(() => {
    if (!isFocusedDisplay) {
      updatePresence({ controlWsConnected: isTelemetryWsConnected });
      setSyncedControlWsConnected(isTelemetryWsConnected);
    }
  }, [isTelemetryWsConnected, isFocusedDisplay, updatePresence]);

  useEffect(() => {
    const key = STORAGE_KEYS.telemetryCount(vehicleId);
    if (!isFocusedDisplay) {
      writeString(key, String(debouncedTelemetryCount));
      setSyncedTelemetryCount(debouncedTelemetryCount);
    }
  }, [debouncedTelemetryCount, isFocusedDisplay, vehicleId]);

  useEffect(() => {
    const key = STORAGE_KEYS.telemetryCount(vehicleId);
    const stored = readString(key);
    const parsed = stored ? Number(stored) : NaN;
    if (Number.isFinite(parsed)) {
      setSyncedTelemetryCount(parsed);
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      const next = event.newValue ? Number(event.newValue) : NaN;
      if (Number.isFinite(next)) {
        setSyncedTelemetryCount(next);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [vehicleId, wsRef]);

  useEffect(() => {
    if (!perfEnabled) return;
    const elapsed = performance.now() - renderStart;
    console.info(`[Perf][render][FocusMapView] ${elapsed.toFixed(1)}ms`);
  });

  useEffect(() => {
    missionsRef.current = missions;
  }, [missions]);

  useEffect(() => {
    draftMissionRef.current = draftMission;
  }, [draftMission]);

  useEffect(() => {
    let mounted = true;
    getMissions(vehicleId)
      .then((entries) => {
        if (mounted) {
          setMissions(entries);
        }
      })
      .catch(() => {
        if (mounted) {
          setMissions([]);
        }
      });
    return () => {
      mounted = false;
    };
  }, [vehicleId, wsRef]);

  useEffect(() => {
    if (!vehicleId) return;
    const key = STORAGE_KEYS.missionDraft(vehicleId);
    const loadDraft = () => {
      const draft = readJson<MissionPlan | null>(key, null);
      if (draft && draft.vehicleId === vehicleId && draft.waypoints?.length) {
        setDraftMission(draft);
      } else {
        setDraftMission(null);
      }
    };
    loadDraft();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === key) {
        loadDraft();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [vehicleId, wsRef]);

  useEffect(() => {
    if (!vehicleId) return;
    const key = STORAGE_KEYS.mapSearchRegion(vehicleId);
    const readLabel = () => {
      const value = readString(key);
      setLastSearchRegionName(value || '');
    };
    readLabel();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === key) readLabel();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [vehicleId]);

  useEffect(() => {
    if (!selectedMissionId) return;
    const selected = missions.find((entry) => entry.id === selectedMissionId);
    if (!selected) return;
    setMissionName(selected.name);
    setMissionPathType(selected.pathType);
    setMissionSpeedMps(selected.speedMps);
    setMissionProfile(selected.profile === 'drone' ? 'drone' : 'rover');
    setArrivalRadiusM(selected.arrivalRadiusM ?? 2);
    setLoiterSeconds(selected.loiterSeconds ?? 0);
    setCruiseAltitudeM(selected.cruiseAltitudeM ?? 10);
    setMissionWaypoints(selected.waypoints);
    if (selected.route) {
      setMissionRoute(selected.route || null);
      triggerRouteFocus();
    } else {
      setMissionRoute(null);
      void getMissionRoute(selected.id).then((route) => {
        if (!route) return;
        setMissionRoute(route);
        setMissions((prev) =>
          prev.map((entry) => (entry.id === selected.id ? { ...entry, route } : entry))
        );
        triggerRouteFocus();
      });
    }
    setRouteAlternatives([]);
    setSelectedRouteIndex(0);
    setRouteSteps([]);
    setHoveredRouteIndex(null);
    setMissionDistance(selected.distanceMeters || 0);
    setMissionEta(selected.etaSeconds || 0);
  }, [missions, selectedMissionId, triggerRouteFocus]);

  useEffect(() => {
    if (missionWaypoints.length >= 2) {
      triggerRouteFocus();
    }
  }, [missionWaypoints, triggerRouteFocus]);

  useEffect(() => {
    if (missionRoute && missionRoute.coordinates.length >= 2) {
      triggerRouteFocus();
    }
  }, [missionRoute, triggerRouteFocus]);

  useEffect(() => {
    if (!vehicleId) return;
    const key = STORAGE_KEYS.missionDraft(vehicleId);
    if (!missionWaypoints.length) {
      removeKey(key);
      return;
    }
    const now = new Date().toISOString();
    writeJson(key, {
      id: `draft:${vehicleId}`,
      vehicleId,
      name: 'Current Map Route',
      pathType: missionPathType,
      speedMps: missionSpeedMps,
      waypoints: missionWaypoints,
      route: missionRoute || undefined,
      distanceMeters: missionDistance || undefined,
      etaSeconds: missionEta || undefined,
      profile: missionProfile,
      arrivalRadiusM,
      loiterSeconds,
      cruiseAltitudeM: missionProfile === 'drone' ? cruiseAltitudeM : undefined,
      createdAt: now,
      updatedAt: now,
    });
  }, [
    vehicleId,
    missionWaypoints,
    missionRoute,
    missionDistance,
    missionEta,
    missionPathType,
    missionSpeedMps,
    missionProfile,
    arrivalRadiusM,
    loiterSeconds,
    cruiseAltitudeM,
  ]);

  const handleMapClick = useCallback(
    (lng: number, lat: number) => {
      if (!planningEnabled) return;
      setMissionWaypoints((prev) => [
        ...prev,
        {
          lng: round(lng, 6),
          lat: round(lat, 6),
          label: `WP ${prev.length + 1}`,
        },
      ]);
    },
    [planningEnabled]
  );

  const handleMapRightClick = useCallback(
    (lng: number, lat: number) => {
      if (!planningEnabled) return;
      setMissionWaypoints((prev) => {
        if (!prev.length) return prev;
        let nearestIndex = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;
        const target = { lat, lng };
        prev.forEach((point, index) => {
          const distance = haversineDistance(point, target);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
          }
        });
        const next = [...prev];
        next.splice(nearestIndex, 1);
        return next;
      });
    },
    [planningEnabled]
  );

  const handleWaypointDrag = useCallback(
    (index: number, lng: number, lat: number) => {
      if (!planningEnabled) return;
      setMissionWaypoints((prev) => {
        if (index < 0 || index >= prev.length) return prev;
        const next = [...prev];
        next[index] = {
          ...next[index],
          lng: round(lng, 6),
          lat: round(lat, 6),
        };
        return next;
      });
    },
    [planningEnabled]
  );

  const handleWaypointClick = useCallback(
    (index: number) => {
      if (!planningEnabled) return;
      setMissionWaypoints((prev) => {
        if (index < 0 || index >= prev.length) return prev;
        const next = [...prev];
        next.splice(index, 1);
        return next;
      });
    },
    [planningEnabled]
  );

  const handleManualAdd = useCallback(() => {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setMissionSaveStatus('Enter valid latitude and longitude values.');
      return;
    }
    setMissionWaypoints((prev) => [
      ...prev,
      {
        lng: round(lng, 6),
        lat: round(lat, 6),
        label: `WP ${prev.length + 1}`,
      },
    ]);
    setManualLat('');
    setManualLng('');
  }, [manualLat, manualLng]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (visualizerRef.current && event.source !== visualizerRef.current.contentWindow) {
        return;
      }
      if (event.origin !== window.location.origin && event.origin !== 'null') {
        return;
      }
      const data = event.data as { type?: string; height?: number };
      if (!data || data.type !== 'ds4-visualizer-size' || typeof data.height !== 'number') {
        return;
      }
      setVisualizerHeight(Math.max(VISUALIZER_MIN_HEIGHT, Math.ceil(data.height)));
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const sendVisualizerMaxHeight = () => {
      const container = visualizerContainerRef.current;
      const iframeWindow = visualizerRef.current?.contentWindow;
      if (!container || !iframeWindow) return;
      const rect = container.getBoundingClientRect();
      const available = Math.max(320, Math.floor(window.innerHeight - rect.top - 24));
      if (Math.abs(available - maxVisualizerHeightRef.current) < 2) return;
      maxVisualizerHeightRef.current = available;
      setVisualizerMaxHeight(available);
      iframeWindow.postMessage({ type: 'ds4-visualizer-maxHeight', maxHeight: available }, '*');
    };

    sendVisualizerMaxHeight();
    const observer = new ResizeObserver(sendVisualizerMaxHeight);
    if (visualizerContainerRef.current) {
      observer.observe(visualizerContainerRef.current);
    }
    window.addEventListener('resize', sendVisualizerMaxHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sendVisualizerMaxHeight);
    };
  }, []);

  const missionDistanceLabel = formatMeters(missionDistance);
  const missionEtaLabel = formatEta(missionEta);
  const missionCanSave = missionWaypoints.length >= 2;
  const latestLocation = locationFeed.latest;
  const headingLabel =
    typeof latestLocation?.heading === 'number' ? `${latestLocation.heading.toFixed(1)}°` : '--';
  const compassLabel = headingToCompass(latestLocation?.heading);
  const speedLabel =
    typeof latestLocation?.speedMps === 'number' ? `${latestLocation.speedMps.toFixed(1)} m/s` : '--';

  const routeCumulative = useMemo(() => {
    if (!missionRoute?.coordinates?.length) return null;
    let sum = 0;
    const result = missionRoute.coordinates.map((coord, index) => {
      if (index > 0) {
        const prev = missionRoute.coordinates[index - 1];
        sum += haversineDistance(
          { lng: prev[0], lat: prev[1] },
          { lng: coord[0], lat: coord[1] }
        );
      }
      return { coord, distance: sum };
    });
    return result;
  }, [missionRoute]);

  const routeTotalDistance = routeCumulative?.[routeCumulative.length - 1]?.distance ?? 0;

  const routeProgressMeters = useMemo(() => {
    if (!latestLocation || !routeCumulative?.length) return null;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < routeCumulative.length; i += 1) {
      const coord = routeCumulative[i].coord;
      const distance = haversineDistance(
        { lng: coord[0], lat: coord[1] },
        { lng: latestLocation.lng, lat: latestLocation.lat }
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }
    return routeCumulative[nearestIndex].distance;
  }, [latestLocation, routeCumulative]);

  const stepDistanceTotal = useMemo(
    () => routeSteps.reduce((sum, step) => sum + (step.distance ?? 0), 0),
    [routeSteps]
  );

  const currentStepIndex = useMemo(() => {
    if (!routeSteps.length || !routeTotalDistance || routeProgressMeters === null) return 0;
    const progressRatio = Math.min(1, Math.max(0, routeProgressMeters / routeTotalDistance));
    const progressMeters = progressRatio * stepDistanceTotal;
    let running = 0;
    for (let i = 0; i < routeSteps.length; i += 1) {
      running += routeSteps[i].distance ?? 0;
      if (progressMeters <= running) return i;
    }
    return Math.max(0, routeSteps.length - 1);
  }, [routeProgressMeters, routeSteps, routeTotalDistance, stepDistanceTotal]);

  const currentStep = routeSteps[currentStepIndex];
  const nextStep = routeSteps[currentStepIndex + 1];
  const lastSeenLabel = deviceStatus.lastSeenMs
    ? new Date(deviceStatus.lastSeenMs).toLocaleString()
    : 'n/a';
  const shouldShowMissionOverlay = missionPrompt !== 'none';
  const displayGamepadConnected = isFocusedDisplay ? syncedGamepadConnected : isGamepadConnected;
  const displayInputWsConnected = isFocusedDisplay ? syncedControlWsConnected : isTelemetryWsConnected;
  const displayTelemetryCount = isFocusedDisplay ? syncedTelemetryCount : telemetryCount;
  const missionListRef = useRef<HTMLDivElement | null>(null);
  const prevMissionScrollDirRef = useRef(0);
  const lastMissionScrollRef = useRef(0);
  const scrollMissionList = useCallback((direction: -1 | 1) => {
    missionListRef.current?.scrollBy({
      top: direction * 64,
      behavior: 'smooth',
    });
  }, []);

  useEffect(() => {
    if (missionPrompt === 'confirm') {
      setMissionActionFocus('confirm');
    }
  }, [missionPrompt]);

  useEffect(() => {
    if (missionPrompt !== 'select') return;
    missionListRef.current?.focus();
  }, [missionPrompt]);

  useEffect(() => {
    if (missionPrompt !== 'select') return;
    const handleMissionListKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        scrollMissionList(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        scrollMissionList(-1);
        return;
      }
      if (event.key === 'PageDown') {
        event.preventDefault();
        missionListRef.current?.scrollBy({ top: 192, behavior: 'smooth' });
        return;
      }
      if (event.key === 'PageUp') {
        event.preventDefault();
        missionListRef.current?.scrollBy({ top: -192, behavior: 'smooth' });
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        missionListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        const target = missionListRef.current;
        target?.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', handleMissionListKey);
    return () => window.removeEventListener('keydown', handleMissionListKey);
  }, [missionPrompt, scrollMissionList]);

  const missionChoices = useMemo(() => {
    const next: MissionPlan[] = [];
    if (draftMission) next.push(draftMission);
    missions.forEach((entry) => next.push(entry));
    return next;
  }, [draftMission, missions]);

  const stepMissionChoice = useCallback((dir: number) => {
    if (!dir) return;
    if (!missionChoices.length) return;
    const currentId =
      selectedMissionId ||
      (activeMissionId && missionChoices.some((entry) => entry.id === activeMissionId)
        ? activeMissionId
        : '');
    const currentIndex = currentId ? missionChoices.findIndex((entry) => entry.id === currentId) : -1;
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + dir + missionChoices.length) % missionChoices.length
        : 0;
    const nextMission = missionChoices[nextIndex] || null;
    if (nextMission) {
      setSelectedMissionId(nextMission.id);
      setPendingMission(nextMission);
      setMissionPrompt('confirm');
      setMissionActionFocus('confirm');
    }
  }, [activeMissionId, missionChoices, selectedMissionId]);

  const resolveSelectedMission = useCallback(() => {
    if (draftMission && selectedMissionId === draftMission.id) return draftMission;
    if (!missions.length) return null;
    if (selectedMissionId) {
      const match = missions.find((entry) => entry.id === selectedMissionId);
      if (match) return match;
    }
    return resolveLatestMission(missions);
  }, [draftMission, missions, selectedMissionId]);

  const sendControlMode = useCallback((mode: 'manual' | 'auto') => {
    const activeLeaseId = controlLeaseIdRef.current;
    if (!activeLeaseId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const payload = {
      seq: controlSeqRef.current++,
      leaseId: activeLeaseId,
      buttons: [],
      axes: [],
      mode,
    };
    const message = clientMessageSchema.safeParse({
      type: 'control',
      vehicleId,
      payload,
    });
    if (message.success) {
      wsRef.current.send(JSON.stringify(message.data));
    }
  }, [vehicleId, wsRef]);

  const handleSetDriveMode = useCallback((mode: 'manual' | 'auto') => {
    setDriveMode(mode);
    sendControlMode(mode);
  }, [sendControlMode]);

  const handleAutoIndicatorClick = () => {
    if (driveModeRef.current === 'manual') {
      requestAutoMode();
    } else {
      cancelMissionPrompt();
    }
  };

  const handleDeviceIndicatorClick = () => {
    setDeviceOverlayOpen(true);
  };

  const handleControllerIndicatorClick = () => {
    setControllerOverlayOpen(true);
  };

  const requestAutoMode = useCallback(() => {
    const selected = resolveSelectedMission();
    if (!selected) {
      setMissionPrompt('select');
      return;
    }
    setPendingMission(selected);
    setMissionPrompt('confirm');
  }, [resolveSelectedMission]);

  const confirmMission = useCallback((mission: MissionPlan) => {
    const payload = buildMissionPayloadFromPlan(mission);
    const message = clientMessageSchema.safeParse({
      type: 'mission',
      vehicleId,
      payload,
    });
    if (message.success && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message.data));
    }
    setActiveMissionId(mission.id);
    setMissionPrompt('none');
    setPendingMission(null);
    handleSetDriveMode('auto');
  }, [handleSetDriveMode, vehicleId, wsRef]);

  const cancelMissionPrompt = useCallback(() => {
    setMissionPrompt('none');
    setPendingMission(null);
    if (driveModeRef.current !== 'manual') {
      handleSetDriveMode('manual');
      setActiveMissionId(null);
    }
  }, [handleSetDriveMode]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSearchOpen(false);
      setSavePromptOpen(false);
      setMapThemesOpen(false);
      setDeviceOverlayOpen(false);
      setControllerOverlayOpen(false);
      if (missionPrompt !== 'none') {
        cancelMissionPrompt();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [missionPrompt, cancelMissionPrompt]);

  useGamepadLoop({
    vehicleId,
    userId: user?.id,
    controlWsRef: wsRef,
    telemetryWsRef,
    telemetryPauseUntilRef,
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
    onGamepadConnectionChange: setIsGamepadConnected,
    onEnqueueTelemetry: (payload) => {
      void enqueueTelemetry(payload, { userId: user?.id, vehicleId });
    },
    onRequestAutoMode: requestAutoMode,
    onCancelMissionPrompt: cancelMissionPrompt,
    onConfirmMission: confirmMission,
    resolveSelectedMission,
    setPendingMission,
    setMissionPrompt,
    setSelectedMissionId,
    onGamepadSample: ({ buttons, now }) => {
      const dpadDown = buttons[13] > 0.5;
      const dpadUp = buttons[12] > 0.5;
      const missionScrollDir = dpadDown ? 1 : dpadUp ? -1 : 0;
      if (missionPromptRef.current === 'select' && missionScrollDir !== 0) {
        if (
          now - lastMissionScrollRef.current > 250 &&
          missionScrollDir !== prevMissionScrollDirRef.current
        ) {
          scrollMissionList(missionScrollDir as -1 | 1);
          lastMissionScrollRef.current = now;
          prevMissionScrollDirRef.current = missionScrollDir;
        }
      }
      if (missionScrollDir === 0) {
        prevMissionScrollDirRef.current = 0;
      }
    },
  });

  const handleUndoWaypoint = useCallback(() => {
    setMissionWaypoints((prev) => prev.slice(0, -1));
  }, []);

  const handleClearWaypoints = useCallback(() => {
    setMissionWaypoints([]);
    setMissionRoute(null);
    setRouteAlternatives([]);
    setSelectedRouteIndex(0);
    setRouteSteps([]);
    setHoveredRouteIndex(null);
    setMissionDistance(0);
    setMissionEta(0);
  }, []);

  const handleSaveMission = useCallback(async (nameOverride?: string) => {
    setMissionSaveStatus(null);
    const sanitizedNameOverride = typeof nameOverride === 'string' ? nameOverride : undefined;
    if (sanitizedNameOverride) {
      setMissionName(sanitizedNameOverride);
    }
    const missionNameValue = (sanitizedNameOverride ?? missionName).trim();
    const payload: Partial<MissionPlan> = {
      vehicleId,
      name: missionNameValue || `Mission ${new Date().toLocaleString()}`,
      pathType: missionPathType,
      speedMps: missionSpeedMps,
      profile: missionProfile,
      arrivalRadiusM,
      loiterSeconds,
      cruiseAltitudeM: missionProfile === 'drone' ? cruiseAltitudeM : undefined,
      waypoints: missionWaypoints,
      distanceMeters: missionDistance || undefined,
      etaSeconds: missionEta || undefined,
    };

    try {
      let missionId = selectedMissionId;
      let next: MissionPlan[] = [];
      if (selectedMissionId) {
        next = await updateMission(selectedMissionId, payload);
        setMissions(next);
        setMissionSaveStatus('Mission updated.');
      } else {
        next = await createMission(payload);
        setMissions(next);
        const created = next.find((entry) => entry.name === payload.name && entry.vehicleId === vehicleId);
        if (created) {
          setSelectedMissionId(created.id);
          missionId = created.id;
        }
        setMissionSaveStatus('Mission saved.');
      }
      if (missionId && missionRoute) {
        await updateMissionRoute(missionId, missionRoute, missionDistance || undefined, missionEta || undefined);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : 'Check server connection.';
      setMissionSaveStatus(`Failed to save mission. ${message}`);
      console.error('Failed to save mission', error);
    }
  }, [
    arrivalRadiusM,
    cruiseAltitudeM,
    loiterSeconds,
    missionDistance,
    missionEta,
    missionName,
    missionPathType,
    missionProfile,
    missionRoute,
    missionSpeedMps,
    missionWaypoints,
    selectedMissionId,
    vehicleId,
  ]);

  const openSavePrompt = useCallback(() => {
    if (!missionCanSave) {
      return;
    }
    const defaultName =
      (lastSearchRegionName && `Route • ${lastSearchRegionName}`) ||
      (missionName.trim() || `Mission ${new Date().toLocaleString()}`);
    setSavePromptName(defaultName);
    setSavePromptOpen(true);
  }, [lastSearchRegionName, missionCanSave, missionName]);

  const handleSavePromptConfirm = useCallback(async () => {
    const name = savePromptName.trim();
    if (!name) {
      return;
    }
    await handleSaveMission(name);
    setSavePromptOpen(false);
  }, [handleSaveMission, savePromptName]);

  const handleDeleteMission = useCallback(async () => {
    if (!selectedMissionId) return;
    try {
      const next = await deleteMission(selectedMissionId);
      setMissions(next);
      setSelectedMissionId(null);
      setMissionSaveStatus('Mission deleted.');
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : 'Check server connection.';
      setMissionSaveStatus(`Failed to delete mission. ${message}`);
      console.error('Failed to delete mission', error);
    }
  }, [selectedMissionId]);

  const missionPlannerProps = useMemo(
    () => ({
      planningEnabled,
      setPlanningEnabled,
      missionPathType,
      setMissionPathType,
      routingStatus,
      missionProfile,
      setMissionProfile,
      missionSpeedMps,
      setMissionSpeedMps,
      missionWaypoints,
      handleUndoWaypoint,
      handleClearWaypoints,
      manualLat,
      setManualLat,
      manualLng,
      setManualLng,
      handleManualAdd,
      arrivalRadiusM,
      setArrivalRadiusM,
      loiterSeconds,
      setLoiterSeconds,
      cruiseAltitudeM,
      setCruiseAltitudeM,
      missionDistanceLabel,
      missionEtaLabel,
      routeAlternatives,
      selectedRouteIndex,
      handleSelectRoute,
      setHoveredRouteIndex,
      routeSteps,
      instructionLocale,
      formatMeters,
      formatEta,
      formatStepInstruction,
      missionName,
      setMissionName,
      handleSaveMission,
      missionCanSave,
      missionSaveStatus,
      selectedMissionId,
      setSelectedMissionId,
      missions,
      vehicleId,
      handleDeleteMission,
    }),
    [
      planningEnabled,
      setPlanningEnabled,
      missionPathType,
      setMissionPathType,
      routingStatus,
      missionProfile,
      setMissionProfile,
      missionSpeedMps,
      setMissionSpeedMps,
      missionWaypoints,
      handleUndoWaypoint,
      handleClearWaypoints,
      manualLat,
      setManualLat,
      manualLng,
      setManualLng,
      handleManualAdd,
      arrivalRadiusM,
      setArrivalRadiusM,
      loiterSeconds,
      setLoiterSeconds,
      cruiseAltitudeM,
      setCruiseAltitudeM,
      missionDistanceLabel,
      missionEtaLabel,
      routeAlternatives,
      selectedRouteIndex,
      handleSelectRoute,
      setHoveredRouteIndex,
      routeSteps,
      instructionLocale,
      missionName,
      setMissionName,
      handleSaveMission,
      missionCanSave,
      missionSaveStatus,
      selectedMissionId,
      setSelectedMissionId,
      missions,
      vehicleId,
      handleDeleteMission,
    ]
  );

  return (
    <main
      className={
        isFocusedDisplay ? 'min-h-screen w-full px-3 py-3 pb-16' : 'container mx-auto max-w-6xl px-4 py-6'
      }
    >
      <header className={isFocusedDisplay ? 'mb-3' : 'mb-6'}>
        {!isFocusedDisplay && (
          <>
            <h1 className="text-2xl font-bold">Realtime Operations</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <p>Vehicle ID: {vehicleId}</p>
              <p>Gamepad: {displayGamepadConnected ? 'connected' : 'disconnected'}</p>
              <p>Input WS: {displayInputWsConnected ? 'connected' : 'disconnected'}</p>
              <p>Inputs sent: {displayTelemetryCount}</p>
            </div>
          </>
        )}
        {isFocusedDisplay && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>User: {user?.username || 'Unknown'}</span>
            <span>
              {vehicleId} {focus ? `(${focus})` : ''}
            </span>
            <span className={controlLeaseId ? 'text-emerald-400' : 'text-amber-400'}>
              Lease: {controlLeaseId ? 'active' : 'missing'}
            </span>
          </div>
        )}
      </header>

      <div className={`grid grid-cols-1 gap-4 ${isFocusedDisplay ? 'min-h-[calc(100vh-5.75rem)]' : 'lg:grid-cols-2'}`}>
          {(isFocusMap || !isFocusedDisplay) && (
            <section className={`space-y-2 ${isFocusedDisplay ? '' : ''}`}>
              <section
                className={`${
                  isFocusMap
                    ? 'relative border-0 bg-transparent p-0 h-[calc(100vh-5.75rem)]'
                    : 'rounded-xl border border-border bg-card p-4'
                } ${isFocusedDisplay ? 'flex min-h-[calc(100vh-5.75rem)] flex-col' : ''}`}
              >
                {!isFocusMap && (
                  <header className="mb-3 flex items-center justify-between">
                    <RealtimeIndicatorsRow
                      deviceOnline={deviceOnline}
                      gamepadConnected={displayGamepadConnected}
                      driveMode={driveMode}
                      onDeviceClick={handleDeviceIndicatorClick}
                      onControllerClick={handleControllerIndicatorClick}
                      onAutoClick={handleAutoIndicatorClick}
                    />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-2.5 py-1">
                        <Wifi
                          className={`size-4 ${
                            locationFeed.isConnected
                              ? 'text-emerald-500 drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]'
                              : 'text-slate-400'
                          }`}
                        />
                      </div>
                    </div>
                  </header>
                )}
                <Suspense fallback={<OpsPanelFallback title="Map" />}>
                  <MapPanel
                    location={locationFeed.latest}
                    peerLocations={coopState.vehicles
                      .filter(
                        (entry) =>
                          entry.vehicleId !== vehicleId &&
                          typeof entry.lat === 'number' &&
                          typeof entry.lng === 'number'
                      )
                      .map((entry) => ({
                        ts: entry.lastUpdatedAt || Date.now(),
                        vehicleId: entry.vehicleId,
                        lat: entry.lat || 0,
                        lng: entry.lng || 0,
                        heading: entry.heading,
                        speedMps: entry.speedMps,
                        username: entry.username,
                      }))}
                    isConnected={locationFeed.isConnected}
                    error={locationFeed.error}
                    style={MAP_THEMES.find((theme) => theme.key === mapThemeKey)?.style}
                    className={
                      isFocusMap
                        ? 'border-0 bg-transparent p-0 h-full rounded-none'
                        : isFocusedDisplay
                          ? 'flex min-h-[calc(100vh-5.75rem)] flex-col'
                          : undefined
                    }
                    mapClassName={
                      isFocusMap
                        ? 'h-full rounded-none'
                        : isFocusedDisplay
                          ? 'min-h-[66vh] flex-1'
                          : undefined
                    }
                    hideStats={isFocusedDisplay}
                    hideHeader={isFocusMap}
                    edgeToEdge={isFocusMap}
                    waypoints={missionWaypoints}
                    route={missionRoute}
                    sharedRoute={coopState.sharedRoute?.route || null}
                    alternativeRoutes={mapRouteAlternatives}
                    selectedAlternativeIndex={selectedRouteIndex}
                    highlightedAlternativeIndex={hoveredRouteIndex}
                    showWaypoints
                    followLocation={isFocusMap ? followVehicleMap : false}
                    followHeading
                    syncKey={`vehicle:${vehicleId}`}
                    syncMode={isFocusMap ? 'write' : 'read'}
                    autoFitRouteSignal={routeFocusSignal}
                    focusRequest={isFocusMap ? searchFocus || undefined : undefined}
                    onMapClick={isFocusMap ? handleMapClick : undefined}
                    onMapRightClick={isFocusMap ? handleMapRightClick : undefined}
                    onWaypointDrag={isFocusMap ? handleWaypointDrag : undefined}
                    onWaypointClick={isFocusMap ? handleWaypointClick : undefined}
                    draggableWaypoints={isFocusMap && planningEnabled}
                    mapOverlay={
                      isFocusMap ? (
                        null
                      ) : null
                    }
                  />
                </Suspense>
                {isFocusMap && (
                  <FocusMapFloatingControls
                    deviceOnline={deviceOnline}
                    gamepadConnected={displayGamepadConnected}
                    driveMode={driveMode}
                    onDeviceClick={handleDeviceIndicatorClick}
                    onControllerClick={handleControllerIndicatorClick}
                    onAutoClick={handleAutoIndicatorClick}
                    onFollow={() => setFollowVehicleMap(true)}
                    onThemes={() => setMapThemesOpen(true)}
                    onMissionPlanner={() => setMissionOverlayOpen(true)}
                    onSearch={() => setSearchOpen(true)}
                  />
                )}
                {isFocusMap && !tbtDismissed && routeSteps.length > 0 && currentStep && (
                  <div className="pointer-events-none fixed bottom-24 right-4 z-40 md:bottom-6">
                    <div
                      className="pointer-events-auto w-[18rem] rounded-xl border border-border/70 bg-card/95 p-3 text-xs shadow-2xl backdrop-blur"
                      style={{ opacity: tbtOpacity }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold">Turn-by-turn</div>
                        <div className="flex items-center gap-1">
                          {routeAlternatives.length > 1 && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setTbtRouteMenuOpen((prev) => !prev)}
                              title="Change route"
                            >
                              <Shuffle className="size-4" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={handleToggleOpacity} title="Transparency">
                            <SlidersHorizontal className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setTbtMinimized((prev) => !prev)}
                            title={tbtMinimized ? 'Expand' : 'Minimize'}
                          >
                            {tbtMinimized ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setTbtDismissed(true)} title="Dismiss">
                            <X className="size-4" />
                          </Button>
                        </div>
                      </div>
                      {tbtRouteMenuOpen && (
                        <div className="mt-2 grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-2">
                          {routeAlternatives.map((route, index) => (
                            <Button
                              key={`alt-${index}`}
                              size="sm"
                              variant={index === selectedRouteIndex ? 'default' : 'outline'}
                              onClick={() => {
                                handleSelectRoute(index);
                                setTbtRouteMenuOpen(false);
                              }}
                              className="justify-between"
                            >
                              <span>Route {index + 1}</span>
                              <span className="text-xs text-muted-foreground">
                                {formatMeters(route.distance)} • {formatEta(route.duration)}
                              </span>
                            </Button>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 space-y-2">
                        <div className="text-sm font-semibold">
                          {formatStepInstruction(currentStep, instructionLocale)}
                        </div>
                        {!tbtMinimized && (
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <div>
                              {currentStep.distance ? `In ${formatMeters(currentStep.distance)}` : 'Continue'}
                            </div>
                            {nextStep && (
                              <div>
                                Next: {formatStepInstruction(nextStep, instructionLocale)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </section>
          )}
          {(isFocusVideo || !isFocusedDisplay) && (
            <section className={`space-y-2 ${isFocusedDisplay ? '' : ''}`}>
              <section className={`rounded-xl border border-border bg-card p-4 ${isFocusedDisplay ? 'flex min-h-[calc(100vh-5.75rem)] flex-col' : ''}`}>
                <header className="mb-3 flex items-center justify-between">
                  <RealtimeIndicatorsRow
                    deviceOnline={deviceOnline}
                    gamepadConnected={displayGamepadConnected}
                    driveMode={driveMode}
                    onDeviceClick={handleDeviceIndicatorClick}
                    onControllerClick={handleControllerIndicatorClick}
                    onAutoClick={handleAutoIndicatorClick}
                  />
                </header>
                <Suspense fallback={<OpsPanelFallback title="Video" />}>
                  <VideoPanel
                    signalingUrl={getDefaultSignalingUrl()}
                    roomId={roomId}
                    viewerId={viewerId}
                    className={isFocusedDisplay ? 'flex min-h-[calc(100vh-5.75rem)] flex-col' : undefined}
                    videoClassName={isFocusedDisplay ? 'h-full min-h-[66vh] flex-1' : undefined}
                    hideFooter={isFocusedDisplay}
                  />
                </Suspense>
              </section>
            </section>
          )}
        {(isFocusControl || !isFocusedDisplay) && (
          <section className={`space-y-2 ${isFocusedDisplay ? '' : 'lg:col-span-2'}`}>
            <section
              className={`rounded-xl border border-border bg-card p-4 ${
                isFocusedDisplay ? 'flex min-h-[calc(100vh-5.75rem)] flex-col' : ''
              }`}
            >
              <header className="relative z-20 mb-3 flex items-center justify-between">
                <RealtimeIndicatorsRow
                  deviceOnline={deviceOnline}
                  gamepadConnected={displayGamepadConnected}
                  driveMode={driveMode}
                  onDeviceClick={handleDeviceIndicatorClick}
                  onControllerClick={handleControllerIndicatorClick}
                  onAutoClick={handleAutoIndicatorClick}
                />
                <span className="text-xs text-muted-foreground">Live visualizer</span>
              </header>
              <div ref={visualizerContainerRef} className={`w-full ${isFocusedDisplay ? 'flex-1' : ''}`}>
                <iframe
                  ref={visualizerRef}
                  src="/visualizer.html"
                  title="Gamepad Visualizer"
                  className="w-full rounded-lg border border-border/60 bg-black"
                  style={{ height: Math.min(visualizerHeight, visualizerMaxHeight) }}
                />
              </div>
            </section>
          </section>
        )}
      </div>
      {isFocusMap && (
        <FocusMapStatusBar
          latitude={formatCoordValue(latestLocation?.lat)}
          longitude={formatCoordValue(latestLocation?.lng)}
          heading={headingLabel}
          compass={compassLabel}
          speed={speedLabel}
          distance={missionDistanceLabel}
          eta={missionEtaLabel}
          weather={weatherStatusLabel}
          weatherIcon={weatherIcon}
        />
      )}
      <OverlayModal
        open={shouldShowMissionOverlay}
        title={missionPrompt === 'confirm' ? 'Confirm mission' : 'Select a mission'}
        onClose={cancelMissionPrompt}
        maxWidthClassName="max-w-xl"
      >
            {missionPrompt === 'select' && (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  No mission is active. Create one in Realtime Ops or choose an existing plan before enabling auto mode.
                </div>
                <div className="relative">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => stepMissionChoice(-1)}
                    aria-label="Previous mission"
                    className="absolute left-0 top-1/2 -translate-y-1/2"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <div
                    ref={missionListRef}
                    tabIndex={0}
                    className="max-h-48 overflow-y-auto rounded-lg border border-border/70 bg-muted/20 px-10 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {missionChoices.length ? (
                      <div className="grid gap-2">
                        {missionChoices.map((entry) => (
                          <Button
                            key={entry.id}
                            size="sm"
                            variant={selectedMissionId === entry.id ? 'default' : 'outline'}
                            className="justify-between"
                            onClick={() => {
                              setSelectedMissionId(entry.id);
                              setPendingMission(entry);
                              setMissionPrompt('confirm');
                            }}
                          >
                            <span>{entry.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {entry.waypoints.length} wp
                            </span>
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No saved missions yet.</div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => stepMissionChoice(1)}
                    aria-label="Next mission"
                    className="absolute right-0 top-1/2 -translate-y-1/2"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      registerSecondaryWindow(
                        window.open((() => {
                          const params = new URLSearchParams();
                          params.set('vehicleId', vehicleId);
                          params.set('focus', 'map');
                          if (sessionId) params.set('session', sessionId);
                          return `/control?${params.toString()}`;
                        })(), '_blank', 'noopener,noreferrer')
                      )
                    }
                  >
                    Open Mission Planner
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => getMissions(vehicleId).then(setMissions)}>
                    Refresh Missions
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelMissionPrompt}>
                    Cancel [O]
                  </Button>
                </div>
              </div>
            )}

            {missionPrompt === 'confirm' && pendingMission && (
              <div className="space-y-4">
                <div className="relative rounded-lg border border-border/70 bg-muted/30 p-3 text-sm">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => stepMissionChoice(-1)}
                    aria-label="Previous mission"
                    className="absolute left-0 top-1/2 -translate-y-1/2"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => stepMissionChoice(1)}
                    aria-label="Next mission"
                    className="absolute right-0 top-1/2 -translate-y-1/2"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <div className="px-10">
                    <div className="font-medium">{pendingMission.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {pendingMission.waypoints.length} waypoints | Speed {pendingMission.speedMps} m/s | Arrival radius{' '}
                      {pendingMission.arrivalRadiusM} m | Loiter {pendingMission.loiterSeconds ?? 0}s
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Distance:{' '}
                      {typeof pendingMission.distanceMeters === 'number'
                        ? `${(pendingMission.distanceMeters / 1000).toFixed(2)} km`
                        : 'n/a'}
                    </div>
                    <div className="mt-3 text-xs font-semibold text-muted-foreground">Waypoint preview</div>
                    <div className="mt-1 space-y-1 text-xs">
                      {pendingMission.waypoints.slice(0, 4).map((wp, index) => (
                        <div key={`${wp.lat}-${wp.lng}-${index}`}>
                          {index + 1}. {formatWaypointPreview(wp.lat, wp.lng)}
                        </div>
                      ))}
                      {pendingMission.waypoints.length > 4 && (
                        <div className="text-muted-foreground">
                          + {pendingMission.waypoints.length - 4} more
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={missionActionFocus === 'confirm' ? 'default' : 'outline'}
                    onClick={() => confirmMission(pendingMission)}
                    onFocus={() => setMissionActionFocus('confirm')}
                    onMouseEnter={() => setMissionActionFocus('confirm')}
                  >
                    Confirm [X]
                  </Button>
                  <Button
                    size="sm"
                    variant={missionActionFocus === 'cancel' ? 'default' : 'outline'}
                    onClick={cancelMissionPrompt}
                    onFocus={() => setMissionActionFocus('cancel')}
                    onMouseEnter={() => setMissionActionFocus('cancel')}
                  >
                    Cancel [O]
                  </Button>
                </div>
              </div>
            )}
      </OverlayModal>
      {sessionId && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-40">
          <CoopChatDock
            coopState={coopState}
            onSendChat={sendChat}
            onClearRoute={clearRoute}
          />
        </div>
      )}
      <OverlayModal
        open={mapThemesOpen}
        title="Map Themes"
        onClose={() => setMapThemesOpen(false)}
        maxWidthClassName="max-w-md"
      >
        <div className="grid gap-2">
          {MAP_THEMES.map((theme) => (
            <Button
              key={theme.key}
              size="sm"
              variant={mapThemeKey === theme.key ? 'default' : 'outline'}
              onClick={() => {
                setMapThemeKey(theme.key);
                setMapThemesOpen(false);
              }}
              className="justify-start"
            >
              <Layers className="mr-2 size-4" />
              {theme.label}
            </Button>
          ))}
        </div>
      </OverlayModal>
      <FocusMapSearchOverlay
        open={searchOpen}
        searchQuery={searchQuery}
        searchStatus={searchStatus}
        searchActionsOpen={searchActionsOpen}
        savePromptOpen={savePromptOpen}
        savePromptName={savePromptName}
        missionCanSave={missionCanSave}
        planningEnabled={planningEnabled}
        lastSearchCoords={lastSearchCoords}
        onClose={() => {
          setSearchOpen(false);
          setSearchActionsOpen(false);
        }}
        onSearchQueryChange={setSearchQuery}
        onSubmit={handleSearchSubmit}
        onToggleActions={() => setSearchActionsOpen((prev) => !prev)}
        onAddWaypoint={handleAddSearchWaypoint}
        onOpenSavePrompt={openSavePrompt}
        onSavePromptNameChange={setSavePromptName}
        onSavePromptConfirm={handleSavePromptConfirm}
        onCloseSavePrompt={() => setSavePromptOpen(false)}
      />
      <FocusMapMissionOverlay
        open={missionOverlayOpen}
        onClose={() => {
          setMissionOverlayOpen(false);
          setShowMissionPlanner(false);
        }}
        missionWaypointsCount={missionWaypoints.length}
        missionDistanceLabel={missionDistanceLabel}
        missionEtaLabel={missionEtaLabel}
        planningEnabled={planningEnabled}
        showMissionPlanner={showMissionPlanner}
        plannerMounted={plannerMounted}
        missionPathType={missionPathType}
        missionProfile={missionProfile}
        routingStatus={routingStatus}
        lastSearchCoords={lastSearchCoords}
        onTogglePlanning={() => setPlanningEnabled((prev) => !prev)}
        onTogglePlanner={() => setShowMissionPlanner((prev) => !prev)}
        onAddLastSearch={handleAddSearchWaypoint}
        onUndoWaypoint={handleUndoWaypoint}
        onClearWaypoints={handleClearWaypoints}
        plannerProps={missionPlannerProps}
      />
      <OverlayModal
        open={deviceOverlayOpen}
        title="Device Details"
        onClose={() => setDeviceOverlayOpen(false)}
      >
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Vehicle Name</span>
            <span>{vehicleInfo?.model || 'Unknown'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Vehicle ID</span>
            <span>{vehicleId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Lease ID</span>
            <span>{controlLeaseId || 'None'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Vehicle Type</span>
            <span>{vehicleInfo?.capabilities?.vehicleClass || 'unknown'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Location</span>
            <span>{vehicleInfo?.location || 'n/a'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Battery</span>
            <span>{typeof vehicleInfo?.charge === 'number' ? `${vehicleInfo.charge}%` : 'n/a'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Health</span>
            <span>{vehicleInfo?.condition ? `${vehicleInfo.condition} (${vehicleInfo.status})` : 'n/a'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Connection Status</span>
            <span>{deviceOnline ? 'Online' : 'Offline'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">IP Address</span>
            <span>{deviceStatus.ip || 'n/a'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Firmware Version</span>
            <span>{deviceStatus.fw || 'n/a'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last Seen</span>
            <span>{lastSeenLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last Location</span>
            <span>
              {latestLocation
                ? `${formatCoordValue(latestLocation.lat)}, ${formatCoordValue(latestLocation.lng)}`
                : 'n/a'}
            </span>
          </div>
        </div>
      </OverlayModal>
      <OverlayModal
        open={controllerOverlayOpen}
        title="Controller Details"
        onClose={() => setControllerOverlayOpen(false)}
      >
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Controller ID</span>
            <span>{controllerInfo.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Connection Status</span>
            <span>{displayGamepadConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Battery</span>
            <span>
              {typeof controllerInfo.battery === 'number'
                ? `${Math.round(controllerInfo.battery * 100)}%`
                : 'n/a'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Mapping</span>
            <span>{controllerInfo.mapping || 'standard'}</span>
          </div>
        </div>
      </OverlayModal>
    </main>
  );
}




