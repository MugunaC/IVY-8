import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/app/context/AuthContext';
import { useTheme } from '@/app/context/ThemeContext';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { OverlayModal } from '@/app/components/ui/overlay-modal';
import { FocusMapView } from '@/app/components/realtime/FocusMapView';
import { ControllerChatPanel } from '@/app/components/realtime/control/ControllerChatPanel';
import { RealtimeIndicatorsRow } from '@/app/components/realtime/control/RealtimeIndicatorsRow';
import { ControllerQuickMenu } from '@/app/components/realtime/control/ControllerQuickMenu';
import { ControllerPanelFallback } from '@/app/components/realtime/control/ControllerPanelFallback';
import { ControllerStatusPanel } from '@/app/components/realtime/control/ControllerStatusPanel';
import { ControllerMissionPanel } from '@/app/components/realtime/control/ControllerMissionPanel';
import { ControllerDiagnosticsPanel } from '@/app/components/realtime/control/ControllerDiagnosticsPanel';
import { ControllerTransportSettings } from '@/app/components/realtime/control/ControllerTransportSettings';
import {
  clamp,
  GamepadState,
  hasGamepadUiChanged,
  haversineMeters,
} from '@/app/components/realtime/control/controlMath';
import {
  buildMissionPayloadFromPlan,
  formatDistanceKm,
  formatHours,
  formatMissionSummary,
  formatSpeedKmh,
  resolveLatestMission,
} from '@/app/components/realtime/missionUtils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { ControllerVisualizerPanel } from '@/app/components/realtime/ControllerVisualizerPanel';
import { useVehicleLocationFeed } from '@/app/hooks/useVehicleLocationFeed';
import { usePresence } from '@/app/hooks/usePresence';
import { useControlSocket } from '@/app/hooks/realtime/useControlSocket';
import { useControllerIndicators } from '@/app/hooks/realtime/useControllerIndicators';
import { useControllerSession } from '@/app/hooks/realtime/useControllerSession';
import { useGamepadLoop } from '@/app/hooks/realtime/useGamepadLoop';
import { useTelemetrySocket } from '@/app/hooks/realtime/useTelemetrySocket';
import { enqueueRecord, enqueueTelemetry } from '@/app/data/inputStore';
import { getMissions } from '@/app/data/missionsRepo';
import { readJson, readString, STORAGE_KEYS, writeJson } from '@/app/data/storage';
import { registerSecondaryWindow } from '@/app/utils/secondaryWindows';
import { isPerfEnabled } from '@/app/utils/perf';
import {
  getDefaultControlWsUrl,
  getDefaultLocationWsUrl,
  getDefaultSignalingUrl,
  getDefaultTelemetryWsUrl,
} from '@/app/utils/wsUrls';
import { appendLog } from '@/app/data/logsRepo';
import { releaseVehicle } from '@/app/data/vehiclesRepo';
import {
  clearLastVehicleSelection,
  clearWsUrlOverride,
  getWsUrlOverride,
  setWsUrlOverride,
} from '@/app/data/settingsRepo';
import { getHomeRoute } from '@/app/utils/navigation';
import { clientMessageSchema } from '@shared/protocol';
import type { CoopStatePayload, MissionPlan, TelemetryPayload } from '@shared/types';
import {
  ChevronLeft,
  ChevronRight,
  Camera,
  Gamepad2,
  LogOut,
  Map as MapIcon,
  MapPin,
  MessageSquare,
  Minimize2,
  Moon,
  Power,
  Sun,
  User as UserIcon,
  Pencil,
  Mail,
  ShieldCheck,
  Activity,
  Wifi,
  WifiOff,
  Cpu,
  Battery,
  Server,
  Terminal,
  Video as VideoIcon,
} from 'lucide-react';

const VideoPanel = lazy(async () => {
  const mod = await import('@/app/components/realtime/VideoPanel');
  return { default: mod.VideoPanel };
});

interface ModulesState {
  video: boolean;
  visualizer: boolean;
  stream: boolean;
}

interface VehicleState {
  id: string;
  model: string;
  location: string;
  charge: number;
  controlLeaseId?: string;
}

interface ControllerLayoutState {
  modules: ModulesState;
  activeMainTab: 'ops' | 'status' | 'stream';
}

export function ControllerPage() {
  const perfEnabled = useMemo(() => isPerfEnabled(), []);
  const renderStart = perfEnabled ? performance.now() : 0;
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const focus = query.get('focus');
  const isFocusMap = focus === 'map';
  const isFocusVideo = focus === 'video';
  const isFocusControl = focus === 'control';
  const isFocusChat = focus === 'chat';
  const isFocusedDisplay = isFocusMap || isFocusVideo || isFocusControl || isFocusChat;

  const [gamepadState, setGamepadState] = useState<GamepadState>({
    buttons: Array(18).fill(0),
    axes: Array(4).fill(0),
    connected: false,
  });
  const [inputPaused, setInputPaused] = useState(false);
  const [pauseLatched, setPauseLatched] = useState(false);
  const [estopLatched, setEstopLatched] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<{
    online: boolean;
    lastSeenMs: number;
    deviceId?: string;
    ip?: string;
    fw?: string;
  }>({ online: false, lastSeenMs: 0 });
  const [deviceOverlayOpen, setDeviceOverlayOpen] = useState(false);
  const [controllerOverlayOpen, setControllerOverlayOpen] = useState(false);
  const [missions, setMissions] = useState<MissionPlan[]>([]);
  const [draftMission, setDraftMission] = useState<MissionPlan | null>(null);
  const [hidSupported, setHidSupported] = useState(false);
  const [hidSecure, setHidSecure] = useState(false);
  const [hidDevice, setHidDevice] = useState<HIDDevice | null>(null);
  const [hidProfile, setHidProfile] = useState<'ds4' | 'dualsense' | 'unknown' | null>(null);
  const [lightbarColor, setLightbarColor] = useState('#4f46e5');
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [serverTelemetryAck, setServerTelemetryAck] = useState<{
    received: number;
    lastAckTs: number | null;
  }>({ received: 0, lastAckTs: null });
  const [visualizerHeight, setVisualizerHeight] = useState(700);
  const [visualizerMaxHeight, setVisualizerMaxHeight] = useState(700);
  const [mapRegionLabel, setMapRegionLabel] = useState<string>('');
  const [modules, setModules] = useState<ModulesState>({
    video: true,
    visualizer: false,
    stream: true,
  });
  const [activeMainTab, setActiveMainTab] = useState<'ops' | 'status' | 'stream'>('ops');
  const [navOpen, setNavOpen] = useState(false);
  const [insightOverlay, setInsightOverlay] = useState<'user' | 'diagnostics' | null>(null);
  const [userEditOpen, setUserEditOpen] = useState(false);
  const [userAvatarEditOpen, setUserAvatarEditOpen] = useState(false);
  const [userDraftName, setUserDraftName] = useState('');
  const [userDraftEmail, setUserDraftEmail] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [coopState, setCoopState] = useState<CoopStatePayload>({
    sessionId: '',
    invitePath: '',
    participants: [],
    vehicles: [],
    messages: [],
    sharedPlan: null,
  });
  const [sessionStats, setSessionStats] = useState({
    totalDistanceM: 0,
    maxSpeedMps: 0,
    activeSeconds: 0,
    activeDays: 0,
  });

  const visualizerRef = useRef<HTMLIFrameElement>(null);
  const visualizerContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const telemetryWsRef = useRef<WebSocket | null>(null);
  const telemetryPauseUntilRef = useRef(0);
  const telemetryCountRef = useRef(0);
  const lastPayloadRef = useRef<TelemetryPayload | null>(null);
  const leaseWarningRef = useRef(false);
  const terminalQueueRef = useRef<string[]>([]);
  const lastDeviceOnlineRef = useRef<boolean | null>(null);
  const pendingTelemetryRef = useRef<string>('No input yet');
  const renderedTelemetryRef = useRef<string>('No input yet');
  const pausedRef = useRef(false);
  const prevPauseButtonRef = useRef(false);
  const prevEstopButtonRef = useRef(false);
  const prevModeButtonRef = useRef(false);
  const prevConfirmButtonRef = useRef(false);
  const prevCancelButtonRef = useRef(false);
  const missionsRef = useRef<MissionPlan[]>([]);
  const prevMissionAxisRef = useRef(0);
  const lastMissionAxisSwitchRef = useRef(0);
  const maxHeightRef = useRef(0);
  const lastGamepadUiUpdateRef = useRef(0);
  const sessionStatsRef = useRef({
    totalDistanceM: 0,
    maxSpeedMps: 0,
    activeSeconds: 0,
    activeDays: new Set<string>(),
    lastPoint: null as { lat: number; lng: number } | null,
    lastTs: null as number | null,
  });
  const GAMEPAD_UI_THROTTLE_MS = 64; // ~15fps for UI, input still at full rate

  const getDefaultWsUrl = () => getDefaultControlWsUrl();

  const resolveWsUrl = () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get('ws');
      if (fromQuery) {
        setWsUrlOverride(fromQuery);
        return fromQuery;
      }
      const fromStorage = getWsUrlOverride();
      if (fromStorage) return fromStorage;
    } catch (error) {
      console.warn('Failed to resolve WS override:', error);
    }
    return getDefaultWsUrl();
  };

  const [wsUrl, setWsUrl] = useState(() => resolveWsUrl());
  const [wsUrlInput, setWsUrlInput] = useState(() => resolveWsUrl());
  const telemetryWsUrl = useMemo(() => getDefaultTelemetryWsUrl(wsUrl), [wsUrl]);

  const buildControlSearch = useCallback(
    (
      nextVehicle: VehicleState | null | undefined,
      options?: {
        focus?: 'map' | 'video' | 'control' | 'chat';
        sessionId?: string;
        spectator?: boolean;
      }
    ) => {
      const params = new URLSearchParams();
      if (nextVehicle?.id) {
        params.set('vehicleId', nextVehicle.id);
        params.set('vehicleModel', nextVehicle.model);
        params.set('vehicleLocation', nextVehicle.location);
        params.set('vehicleCharge', String(nextVehicle.charge));
      }
      if (options?.focus) params.set('focus', options.focus);
      if (options?.sessionId) params.set('session', options.sessionId);
      if (options?.spectator) {
        params.set('spectator', '1');
      }
      return params.toString() ? `?${params.toString()}` : '';
    },
    []
  );


  const queryVehicle = useMemo<VehicleState | null>(() => {
    const params = new URLSearchParams(location.search);
    const vehicleId = params.get('vehicleId');
    if (!vehicleId) return null;
    const vehicleModel = params.get('vehicleModel') || `Vehicle ${vehicleId}`;
    const vehicleLocation = params.get('vehicleLocation') || 'Unknown';
    const rawCharge = Number(params.get('vehicleCharge'));
    const vehicleCharge = Number.isFinite(rawCharge) ? Math.max(0, Math.min(100, rawCharge)) : 0;
    return { id: vehicleId, model: vehicleModel, location: vehicleLocation, charge: vehicleCharge };
  }, [location.search]);

  const vehicle = (location.state?.vehicle as VehicleState | undefined) || queryVehicle;
  const vehicleId = vehicle?.id || 'VH-001';
  const sessionId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('session') || '';
  }, [location.search]);
  const isSpectatorSession = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('spectator') === '1';
  }, [location.search]);
  const { presence, updatePresence, isOwner: isPresenceOwner } = usePresence(vehicleId);
  const {
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
  } = useControllerSession({
    vehicleId,
    user,
    isSpectatorSession,
    isPresenceOwner,
    presence,
    updatePresence,
    initialDriveMode: 'manual',
    initialControlLeaseId: vehicle?.controlLeaseId ?? null,
  });
  const {
    deviceOnline,
    setDeviceOnline,
    controllerInfo,
    batteryLevel,
    setBatteryLevel,
    hapticsSupported,
    setHapticsSupported,
    hapticsSupportedRef,
  } = useControllerIndicators({
    presence,
    isPresenceOwner,
    updatePresence,
  });
  const viewerId = user?.id || 'anon-viewer';
  const roomId = useMemo(() => `vehicle-room-${vehicleId}`, [vehicleId]);
  const canUseHid = hidSupported && hidSecure;
  const coopParticipants = coopState.participants;
  const isCoopHost = Boolean(user?.id && coopState.hostUserId === user.id);
  const inviteUrl =
    typeof window !== 'undefined' && coopState.invitePath
      ? `${window.location.origin}${coopState.invitePath}`
      : '';
  const layoutKey = useMemo(
    () => (user?.id && vehicle?.id ? STORAGE_KEYS.controlLayout(user.id, vehicle.id) : null),
    [user?.id, vehicle?.id]
  );

  useEffect(() => {
    if (!vehicle || isFocusedDisplay) return;
    const expectedSearch = buildControlSearch(vehicle, {
      sessionId,
      spectator: isSpectatorSession,
    });
    if (expectedSearch && location.search !== expectedSearch) {
      navigate(
        {
          pathname: location.pathname,
          search: expectedSearch,
        },
        { replace: true }
      );
    }
  }, [
    buildControlSearch,
    isFocusedDisplay,
    isSpectatorSession,
    location.pathname,
    location.search,
    navigate,
    sessionId,
    vehicle,
  ]);

  const { wsRef: controlSocketRef, isConnected: isControlWsConnected } = useControlSocket({
    url: wsUrl,
    vehicleId,
    onOpen: () => {
      addTerminalLine('Control WebSocket connected to server');
    },
    onDeviceStatus: (status) => {
      setDeviceOnline(status.online);
      setDeviceStatus(status);
      if (status.online && lastDeviceOnlineRef.current !== true) {
        addTerminalLine(`Device heartbeat received for ${vehicleId}.`);
      }
      lastDeviceOnlineRef.current = status.online;
    },
    onError: (message) => {
      addTerminalLine(`Server error: ${message}`);
    },
    onServerMessage: (message) => {
      if (message.type === 'cpp') {
        addTerminalLine(`Server: ${message.text}`);
        return;
      }
      if (message.type === 'input_ack') {
        setServerTelemetryAck({ received: message.received, lastAckTs: message.ts });
        return;
      }
      if (message.type === 'coop_state' && (!sessionId || message.payload.sessionId === sessionId)) {
        setCoopState(message.payload);
        return;
      }
      if (message.type === 'coop_chat' && (!sessionId || message.payload.sessionId === sessionId)) {
        setCoopState((prev) => ({
          ...prev,
          messages: [...prev.messages, message.payload].slice(-50),
        }));
      }
    },
  });

  const { wsRef: telemetrySocketRef } = useTelemetrySocket({
    url: telemetryWsUrl,
    vehicleId,
    onError: (message) => {
      addTerminalLine(message);
    },
    onServerMessage: (message) => {
      if (message.type === 'slow_down') {
        telemetryPauseUntilRef.current = Date.now() + message.retryAfterMs;
      }
    },
  });

  wsRef.current = controlSocketRef.current;
  telemetryWsRef.current = telemetrySocketRef.current;

  useEffect(() => {
    setCoopState({
      sessionId,
      invitePath: '',
      participants: [],
      vehicles: [],
      messages: [],
      sharedPlan: null,
    });
  }, [sessionId]);

  const locationFeed = useVehicleLocationFeed({
    wsUrl: getDefaultLocationWsUrl(),
    vehicleId,
  });

  useEffect(() => {
    sessionStatsRef.current = {
      totalDistanceM: 0,
      maxSpeedMps: 0,
      activeSeconds: 0,
      activeDays: new Set<string>(),
      lastPoint: null,
      lastTs: null,
    };
    setSessionStats({
      totalDistanceM: 0,
      maxSpeedMps: 0,
      activeSeconds: 0,
      activeDays: 0,
    });
  }, [vehicleId]);

  useEffect(() => {
    const latest = locationFeed.latest;
    if (!latest) return;
    const stats = sessionStatsRef.current;
    const ts = Number.isFinite(latest.ts) ? latest.ts : Date.now();
    if (typeof latest.speedMps === 'number') {
      stats.maxSpeedMps = Math.max(stats.maxSpeedMps, latest.speedMps);
    }
    const dayKey = new Date(ts).toISOString().slice(0, 10);
    stats.activeDays.add(dayKey);

    if (stats.lastPoint && typeof stats.lastTs === 'number') {
      const distance = haversineMeters(stats.lastPoint, { lat: latest.lat, lng: latest.lng });
      if (Number.isFinite(distance) && distance >= 0 && distance < 5000) {
        stats.totalDistanceM += distance;
      }
      const deltaSeconds = Math.max(0, (ts - stats.lastTs) / 1000);
      if (deltaSeconds > 0 && deltaSeconds < 120) {
        stats.activeSeconds += deltaSeconds;
      }
    }

    stats.lastPoint = { lat: latest.lat, lng: latest.lng };
    stats.lastTs = ts;

    setSessionStats({
      totalDistanceM: stats.totalDistanceM,
      maxSpeedMps: stats.maxSpeedMps,
      activeSeconds: stats.activeSeconds,
      activeDays: stats.activeDays.size,
    });
  }, [locationFeed.latest]);

  useEffect(() => {
    if (!isFocusedDisplay) return;
    setActiveMainTab('ops');
    setModules({
      video: isFocusVideo,
      visualizer: isFocusControl,
      stream: isFocusChat,
    });
  }, [isFocusedDisplay, isFocusVideo, isFocusControl, isFocusChat]);

  useEffect(() => {
    if (!layoutKey || isFocusedDisplay) return;
    const stored = readJson<ControllerLayoutState | null>(layoutKey, null);
    if (!stored) return;
    if (stored.activeMainTab) {
      setActiveMainTab(stored.activeMainTab);
    }
    if (stored.modules) {
      setModules(stored.modules);
    }
  }, [isFocusedDisplay, layoutKey]);

  useEffect(() => {
    if (!layoutKey || isFocusedDisplay) return;
    writeJson<ControllerLayoutState>(layoutKey, {
      modules,
      activeMainTab,
    });
  }, [activeMainTab, isFocusedDisplay, layoutKey, modules]);

  const addTerminalLine = useCallback((line: string) => {
    terminalQueueRef.current.push(`[${new Date().toLocaleTimeString()}] ${line}`);
  }, []);

  const sendClientMessage = useCallback((message: unknown) => {
    const result = clientMessageSchema.safeParse(message);
    if (!result.success) {
      addTerminalLine('Failed to send message: invalid payload');
      return;
    }
    const payload = result.data;
    const target =
      payload.type === 'input' ? telemetryWsRef.current : wsRef.current;
    if (target && target.readyState === WebSocket.OPEN) {
      target.send(JSON.stringify(payload));
    }
  }, [addTerminalLine]);

  useEffect(() => {
    const socket = wsRef.current;
    if (!isControlWsConnected || !socket || socket.readyState !== WebSocket.OPEN || !sessionId || !user?.id || !user.username) return;
    sendClientMessage({
      type: 'coop_join',
      sessionId,
      vehicleId: isSpectatorSession ? undefined : vehicleId,
      userId: user.id,
      username: user.username,
      role: isSpectatorSession ? 'spectator' : 'driver',
    });
    return () => {
      if (socket.readyState === WebSocket.OPEN) {
        sendClientMessage({
          type: 'coop_leave',
          sessionId,
          userId: user.id,
        });
      }
    };
  }, [isControlWsConnected, sendClientMessage, isSpectatorSession, sessionId, user?.id, user?.username, vehicleId]);

  const sendControlMode = useCallback((mode: 'manual' | 'auto') => {
    if (!vehicle) return;
    if (!controlLeaseId) {
      addTerminalLine('Control lease missing; cannot change drive mode.');
      return;
    }
    const snapshot = lastPayloadRef.current;
    const buttons = snapshot?.buttons ?? gamepadState.buttons;
    const axes = snapshot?.axes ?? gamepadState.axes;
    sendClientMessage({
      type: 'control',
      vehicleId: vehicle.id,
      payload: {
        seq: controlSeqRef.current++,
        leaseId: controlLeaseId,
        buttons,
        axes,
        mode,
      },
    });
  }, [addTerminalLine, controlLeaseId, gamepadState.axes, gamepadState.buttons, sendClientMessage, vehicle]);

  const refreshMissions = useCallback(async () => {
    if (!vehicle) return;
    try {
      const entries = await getMissions(vehicle.id);
      setMissions(entries);
      if (entries.length && !selectedMissionId) {
        const latest = resolveLatestMission(entries);
        if (latest) setSelectedMissionId(latest.id);
      }
    } catch (error) {
      console.warn('Failed to load missions:', error);
    }
  }, [selectedMissionId, vehicle]);

  const resolveSelectedMission = useCallback(() => {
    if (draftMission && selectedMissionId === draftMission.id) return draftMission;
    if (!missions.length) return null;
    if (selectedMissionId) {
      const match = missions.find((entry) => entry.id === selectedMissionId);
      if (match) return match;
    }
    return resolveLatestMission(missions);
  }, [draftMission, missions, selectedMissionId]);
  const missionChoices = useMemo(() => {
    const next: MissionPlan[] = [];
    if (draftMission) next.push(draftMission);
    missions.forEach((entry) => next.push(entry));
    return next;
  }, [draftMission, missions]);
  const missionListRef = useRef<HTMLDivElement | null>(null);
  const prevMissionScrollDirRef = useRef(0);
  const lastMissionScrollRef = useRef(0);

  const formatWaypointPreview = (lat: number, lng: number) =>
    `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  const scrollMissionList = useCallback((direction: -1 | 1) => {
    missionListRef.current?.scrollBy({
      top: direction * 64,
      behavior: 'smooth',
    });
  }, []);

  const cycleMissionSelection = useCallback((direction: -1 | 1) => {
    const saved = missionsRef.current;
    const draft = draftMissionRef.current;
    const choices = [
      ...(draft ? [draft] : []),
      ...saved,
    ];
    if (!choices.length) {
      void refreshMissions();
      return;
    }
    const currentId =
      selectedMissionIdRef.current ||
      (activeMissionIdRef.current && choices.some((entry) => entry.id === activeMissionIdRef.current)
        ? activeMissionIdRef.current
        : '');
    const currentIndex = currentId ? choices.findIndex((entry) => entry.id === currentId) : -1;
    const nextIndex =
      currentIndex >= 0 ? (currentIndex + direction + choices.length) % choices.length : 0;
    const nextMission = choices[nextIndex] || null;
    if (nextMission) {
      setSelectedMissionId(nextMission.id);
      setPendingMission(nextMission);
      setMissionPrompt('confirm');
    }
  }, [refreshMissions]);

  const selectedMission = useMemo(() => resolveSelectedMission(), [resolveSelectedMission]);
  const shouldShowMissionOverlay =
    missionPrompt !== 'none' && Boolean(vehicle) && !location.pathname.startsWith('/admin');

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

  useEffect(() => {
    if (!vehicleId) return;
    const key = STORAGE_KEYS.mapSearchRegion(vehicleId);
    const readLabel = () => {
      const value = readString(key);
      setMapRegionLabel(value || '');
    };
    readLabel();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === key) readLabel();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [vehicleId]);

  useEffect(() => {
    missionsRef.current = missions;
  }, [missions]);

  useEffect(() => {
    draftMissionRef.current = draftMission;
  }, [draftMission]);

  const requestAutoMode = useCallback(() => {
    const selected = resolveSelectedMission();
    if (!selected) {
      setMissionPrompt('select');
      void refreshMissions();
      return;
    }
    setPendingMission(selected);
    setMissionPrompt('confirm');
  }, [refreshMissions, resolveSelectedMission]);

  const confirmMission = useCallback((mission: MissionPlan) => {
    if (!vehicle) return;
    const payload = buildMissionPayloadFromPlan(mission);
    sendClientMessage({ type: 'mission', vehicleId: vehicle.id, payload });
    setActiveMissionId(mission.id);
    setDriveMode('auto');
    setMissionPrompt('none');
    setPendingMission(null);
    lastAutoControlSentRef.current = 0;
    sendControlMode('auto');
    addTerminalLine(`Mission confirmed: ${mission.name}`);
  }, [addTerminalLine, sendClientMessage, sendControlMode, vehicle]);

  const cancelMissionPrompt = useCallback(() => {
    setMissionPrompt('none');
    setPendingMission(null);
    if (driveModeRef.current !== 'manual') {
      setDriveMode('manual');
      sendControlMode('manual');
    }
  }, [sendControlMode]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDeviceOverlayOpen(false);
      setControllerOverlayOpen(false);
      setNavOpen(false);
      if (missionPrompt !== 'none') {
        cancelMissionPrompt();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [missionPrompt, cancelMissionPrompt]);

  const handleAutoIndicatorClick = useCallback(() => {
    if (driveMode === 'auto') {
      cancelMissionPrompt();
    } else {
      requestAutoMode();
    }
  }, [driveMode, cancelMissionPrompt, requestAutoMode]);

  const stopVehicleNow = () => {
    if (!vehicle || !controlLeaseId) {
      addTerminalLine('Control lease missing; cannot stop vehicle.');
      return;
    }
    setDriveMode('manual');
    const neutralButtons = Array(gamepadState.buttons.length).fill(0);
    const neutralAxes = Array(gamepadState.axes.length).fill(0);
    sendClientMessage({
      type: 'control',
      vehicleId: vehicle.id,
      payload: {
        seq: controlSeqRef.current++,
        leaseId: controlLeaseId,
        buttons: neutralButtons,
        axes: neutralAxes,
        mode: 'manual',
      },
    });
    addTerminalLine('Stop command sent.');
  };

  const sendRetraceMission = () => {
    const selected = resolveSelectedMission();
    if (!selected) {
      setMissionPrompt('select');
      return;
    }
    if (!vehicle) return;
    const reversed = { ...selected, waypoints: [...selected.waypoints].reverse() };
    const payload = buildMissionPayloadFromPlan(reversed);
    sendClientMessage({ type: 'mission', vehicleId: vehicle.id, payload });
    setActiveMissionId(selected.id);
    setDriveMode('auto');
    setMissionPrompt('none');
    setPendingMission(null);
    sendControlMode('auto');
    addTerminalLine('Retrace mission sent.');
  };

  useEffect(() => {
    const flush = window.setInterval(() => {
      if (terminalQueueRef.current.length > 0) {
        const nextLines = terminalQueueRef.current.splice(0, terminalQueueRef.current.length);
        setTerminalOutput((prev) => [...prev, ...nextLines].slice(-100));
      }
      if (pendingTelemetryRef.current !== renderedTelemetryRef.current) {
        renderedTelemetryRef.current = pendingTelemetryRef.current;
      }
    }, 120);

    return () => window.clearInterval(flush);
  }, []);

  useEffect(() => {
    if (activeMainTab !== 'status') return;
    setHidSupported(typeof navigator !== 'undefined' && !!navigator.hid);
    setHidSecure(typeof window !== 'undefined' && window.isSecureContext);
  }, [activeMainTab]);

  useEffect(() => {
    if (!vehicle) return;
    void refreshMissions();
  }, [refreshMissions, vehicle]);

  useEffect(() => {
    updatePresence({ gamepadConnected: gamepadState.connected });
  }, [gamepadState.connected, updatePresence]);

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
  }, [vehicleId]);

  useEffect(() => {
    if (missionPrompt === 'select' && selectedMissionId) {
      const selected = resolveSelectedMission();
      if (selected) {
        setPendingMission(selected);
        setMissionPrompt('confirm');
      }
    }
  }, [missionPrompt, resolveSelectedMission, selectedMissionId]);

  useEffect(() => {
    if (!vehicle) {
      navigate(getHomeRoute(user?.role), { replace: true });
    }
  }, [vehicle, navigate, user?.role]);

  useEffect(() => {
    if (controlLeaseId) {
      leaseWarningRef.current = false;
    }
  }, [controlLeaseId]);

  useEffect(() => {
    const blocked = pauseLatched || estopLatched;
    pausedRef.current = blocked;
    if (!blocked) lastPayloadRef.current = null;
    if (visualizerRef.current?.contentWindow) {
      visualizerRef.current.contentWindow.postMessage({ type: 'ds4-visualizer-pause', paused: blocked }, '*');
    }
  }, [pauseLatched, estopLatched]);

  useGamepadLoop({
    vehicleId,
    userId: user?.id,
    controlWsRef: wsRef,
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
    inputBlockedRef: pausedRef,
    onGamepadConnectionChange: (connected) => {
      setGamepadState((prev) => (prev.connected === connected ? prev : { ...prev, connected }));
    },
    onEnqueueTelemetry: (payload) => {
      pendingTelemetryRef.current = JSON.stringify(payload);
      void enqueueTelemetry(payload, { userId: user?.id, vehicleId });
    },
    onRequestAutoMode: requestAutoMode,
    onCancelMissionPrompt: cancelMissionPrompt,
    onConfirmMission: confirmMission,
    resolveSelectedMission,
    setPendingMission,
    setMissionPrompt,
    setSelectedMissionId: (id) => setSelectedMissionId(id ?? ''),
    onGamepadSample: ({ gamepad, buttons, axes, now }) => {
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

      const pausePressed = buttons[8] > 0.5;
      const estopPressed = buttons[16] > 0.5;
      const pauseRising = pausePressed && !prevPauseButtonRef.current;
      const estopRising = estopPressed && !prevEstopButtonRef.current;

      if (pauseRising && !estopLatched) {
        setPauseLatched((prev) => !prev);
      }
      if (estopRising) {
        setEstopLatched((prev) => {
          const next = !prev;
          setPauseLatched(next);
          return next;
        });
      }

      prevPauseButtonRef.current = pausePressed;
      prevEstopButtonRef.current = estopPressed;

      if (now - lastGamepadUiUpdateRef.current >= GAMEPAD_UI_THROTTLE_MS) {
        lastGamepadUiUpdateRef.current = now;
        setGamepadState((prev) =>
          hasGamepadUiChanged(prev, buttons, axes, true) ? { buttons, axes, connected: true } : prev
        );

        const battery = (gamepad as Gamepad & { battery?: { level?: number | null } }).battery?.level;
        if (typeof battery === 'number' && !Number.isNaN(battery)) {
          const nextBattery = Math.round(clamp(battery, 0, 1) * 100);
          setBatteryLevel((prev) => (prev === nextBattery ? prev : nextBattery));
        }
      }

      const supportsHaptics = !!(gamepad as any)?.vibrationActuator || !!(gamepad as any)?.hapticActuators?.length;
      if (supportsHaptics !== hapticsSupportedRef.current) {
        hapticsSupportedRef.current = supportsHaptics;
        setHapticsSupported(supportsHaptics);
      }
    },
    onLeaseMissing: () => {
      if (!leaseWarningRef.current) {
        leaseWarningRef.current = true;
        addTerminalLine('Control lease missing; re-select vehicle to start a control session.');
      }
    },
  });

  useEffect(() => {
    setWsUrlInput(wsUrl);
  }, [wsUrl]);

  useEffect(() => {
    if (activeMainTab !== 'ops' || !modules.visualizer) return;
    const handleMessage = (event: MessageEvent) => {
      if (visualizerRef.current && event.source !== visualizerRef.current.contentWindow) return;
      if (event.origin !== window.location.origin && event.origin !== 'null') return;
      const data = event.data as { type?: string; height?: number };
      if (!data || data.type !== 'ds4-visualizer-size' || typeof data.height !== 'number') return;
      setVisualizerHeight(Math.max(380, Math.ceil(data.height)));
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [activeMainTab, modules.visualizer]);

  const sendVisualizerMaxHeight = () => {
    const container = visualizerContainerRef.current;
    const iframeWindow = visualizerRef.current?.contentWindow;
    if (!container || !iframeWindow) return;
    const rect = container.getBoundingClientRect();
    const available = Math.max(320, Math.floor(window.innerHeight - rect.top - 24));
    if (Math.abs(available - maxHeightRef.current) < 2) return;
    maxHeightRef.current = available;
    setVisualizerMaxHeight(available);
    iframeWindow.postMessage({ type: 'ds4-visualizer-maxHeight', maxHeight: available }, '*');
  };

  useEffect(() => {
    if (activeMainTab !== 'ops' || !modules.visualizer) return;
    sendVisualizerMaxHeight();
    const observer = new ResizeObserver(sendVisualizerMaxHeight);
    if (visualizerContainerRef.current) observer.observe(visualizerContainerRef.current);
    window.addEventListener('resize', sendVisualizerMaxHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sendVisualizerMaxHeight);
    };
  }, [activeMainTab, modules.visualizer]);

  const lastSeenLabel = deviceStatus.lastSeenMs
    ? new Date(deviceStatus.lastSeenMs).toLocaleString()
    : 'n/a';
  const controlWsState =
    typeof WebSocket !== 'undefined' && wsRef.current?.readyState === WebSocket.OPEN
      ? 'Connected'
      : 'Disconnected';
  const telemetryWsState =
    typeof WebSocket !== 'undefined' && telemetryWsRef.current?.readyState === WebSocket.OPEN
      ? 'Connected'
      : 'Disconnected';
  const userInitials = (user?.username || 'User').slice(0, 2).toUpperCase();
  const distanceLabel = formatDistanceKm(sessionStats.totalDistanceM);
  const maxSpeedLabel = formatSpeedKmh(sessionStats.maxSpeedMps);
  const activeHoursLabel = formatHours(sessionStats.activeSeconds);
  const activeDaysLabel = `${sessionStats.activeDays} days`;

  const handleWsSave = () => {
    const nextUrl = wsUrlInput.trim();
    if (!nextUrl) return;
    setWsUrlOverride(nextUrl);
    setWsUrl(nextUrl);
    addTerminalLine(`WebSocket URL set to ${nextUrl}`);
  };

  const handleWsClear = () => {
    clearWsUrlOverride();
    const nextUrl = getDefaultWsUrl();
    setWsUrl(nextUrl);
    setWsUrlInput(nextUrl);
    addTerminalLine('WebSocket URL reset to default');
  };

  const triggerHaptics = async () => {
    const gamepad = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    const actuator: any = (gamepad as any)?.vibrationActuator || (gamepad as any)?.hapticActuators?.[0];
    if (!actuator) {
      setHapticsSupported(false);
      addTerminalLine('Haptics not supported by this controller/browser.');
      return;
    }
    setHapticsSupported(true);
    try {
      if (typeof actuator.playEffect === 'function') {
        await actuator.playEffect('dual-rumble', {
          duration: 160,
          strongMagnitude: 0.8,
          weakMagnitude: 0.6,
        });
      } else if (typeof actuator.pulse === 'function') {
        await actuator.pulse(0.8, 160);
      }
    } catch (error) {
      console.warn('Failed to trigger haptics', error);
    }
  };

  const detectHidProfile = (device: HIDDevice): 'ds4' | 'dualsense' | 'unknown' => {
    const name = device.productName?.toLowerCase() || '';
    if (name.includes('dualsense') || name.includes('ps5')) return 'dualsense';
    if (name.includes('dualshock') || name.includes('wireless controller') || name.includes('ps4')) return 'ds4';
    return 'unknown';
  };

  const hexToRgb = (hex: string) => {
    const sanitized = hex.replace('#', '');
    const value = sanitized.length === 3 ? sanitized.split('').map((c) => c + c).join('') : sanitized;
    const num = Number.parseInt(value, 16);
    return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
  };

  const sendLightbarColor = async (
    device: HIDDevice,
    colorHex: string,
    profile: 'ds4' | 'dualsense' | 'unknown'
  ) => {
    if (!device.opened) await device.open();
    const { r, g, b } = hexToRgb(colorHex);

    if (profile === 'dualsense') {
      const payloadA = new Uint8Array(48);
      payloadA[0] = 0x02;
      payloadA[1] = 0x01;
      payloadA[6] = r;
      payloadA[7] = g;
      payloadA[8] = b;

      const payloadB = new Uint8Array(48);
      payloadB[0] = 0x02;
      payloadB[1] = 0x02;
      payloadB[6] = r;
      payloadB[7] = g;
      payloadB[8] = b;

      try {
        await device.sendReport(0x02, payloadA);
      } catch (error) {
        console.warn('DualSense lightbar attempt A failed', error);
      }
      try {
        await device.sendReport(0x02, payloadB);
      } catch (error) {
        console.warn('DualSense lightbar attempt B failed', error);
      }
      return;
    }

    const data = new Uint8Array(32);
    data[0] = 0xff;
    data[1] = 0x04;
    data[4] = r;
    data[5] = g;
    data[6] = b;
    await device.sendReport(0x05, data);
  };

  const handleHidInputReport = (event: HIDInputReportEvent) => {
    const data = event.data;
    if (!data) return;
    let level: number | null = null;
    if (hidProfile === 'dualsense') {
      if (data.byteLength >= 54) {
        const raw = data.getUint8(53);
        level = raw & 0x0f;
      }
    } else if (data.byteLength >= 30) {
      const raw = data.getUint8(29);
      level = raw & 0x0f;
    }
    if (level !== null && Number.isFinite(level) && level <= 15) {
      const percent = Math.min(100, Math.round((level / 15) * 100));
      if (!Number.isNaN(percent)) setBatteryLevel(percent);
    }
  };

  const handleConnectHid = async () => {
    if (!hidSupported || !navigator.hid) {
      addTerminalLine('WebHID not supported in this browser.');
      return;
    }
    if (!hidSecure) {
      addTerminalLine('WebHID requires HTTPS or localhost.');
      return;
    }

    try {
      const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x054c }] });
      if (!devices.length) return;
      const device = devices[0];
      const profile = detectHidProfile(device);
      await device.open();
      device.addEventListener('inputreport', handleHidInputReport as EventListener);
      setHidDevice(device);
      setHidProfile(profile);
      await sendLightbarColor(device, lightbarColor, profile);
      addTerminalLine(`Controller connected via HID (${profile}).`);
    } catch (error) {
      console.warn('Failed to connect HID device', error);
    }
  };

  const handleDisconnectHid = async () => {
    if (!hidDevice) return;
    try {
      hidDevice.removeEventListener('inputreport', handleHidInputReport as EventListener);
      if (hidDevice.opened) await hidDevice.close();
    } catch (error) {
      console.warn('Failed to disconnect HID device', error);
    } finally {
      setHidDevice(null);
      setHidProfile(null);
    }
  };

  useEffect(() => {
    if (!hidSupported || !navigator.hid) return;
    const hid = navigator.hid;
    const handleDisconnect = (event: HIDConnectionEvent) => {
      if (hidDevice && event.device === hidDevice) {
        setHidDevice(null);
        setHidProfile(null);
        addTerminalLine('Controller disconnected.');
      }
    };
    hid.addEventListener('disconnect', handleDisconnect);
    return () => hid.removeEventListener('disconnect', handleDisconnect);
  }, [addTerminalLine, hidDevice, hidSupported]);

  useEffect(() => {
    setUserDraftName(user?.username || '');
    setUserDraftEmail(user?.email || '');
  }, [user?.email, user?.username]);

  useEffect(() => {
    if (!perfEnabled) return;
    const elapsed = performance.now() - renderStart;
    console.info(`[Perf][render][ControllerPage] ${elapsed.toFixed(1)}ms`);
  });

  const toggleModule = (key: keyof ModulesState) => {
    setModules((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const openFocusedWindow = (nextFocus: 'map' | 'video' | 'control' | 'chat') => {
    const popup = window.open(
      `/control${buildControlSearch(vehicle, {
        focus: nextFocus,
        sessionId,
        spectator: isSpectatorSession,
      })}`,
      '_blank',
      'noopener,noreferrer'
    );
    popup?.focus();
    registerSecondaryWindow(popup);
  };

  const openMapWindow = () => {
    openFocusedWindow('map');
  };

  const openVideoWindow = () => {
    openFocusedWindow('video');
  };

  const openControlWindow = () => {
    openFocusedWindow('control');
  };

  const openChatWindow = () => {
    openFocusedWindow('chat');
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleOpenInsight = (view: 'user' | 'diagnostics') => {
    setInsightOverlay(view);
    setNavOpen(false);
  };

  const handleSendCoopMessage = (nextText?: string) => {
    const text = (nextText ?? '').trim();
    if (!text || !sessionId || !user?.id || !user.username) return;
    sendClientMessage({
      type: 'coop_chat',
      sessionId,
      vehicleId: isSpectatorSession ? undefined : vehicleId,
      userId: user.id,
      username: user.username,
      text,
    });
  };

  const handleClearCoopMessages = () => {
    if (!sessionId || !user?.id) return;
    sendClientMessage({
      type: 'coop_chat_clear',
      sessionId,
      userId: user.id,
    });
  };

  const handleStartCoopSession = () => {
    const nextSessionId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 12)
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const params = new URLSearchParams(location.search);
    params.set('session', nextSessionId);
    params.delete('spectator');
    navigate(
      {
        pathname: location.pathname,
        search: buildControlSearch(vehicle, {
          sessionId: params.get('session') || '',
          spectator: false,
        }),
      },
      { replace: false }
    );
  };

  const handleJoinCoopSession = (nextSessionId: string, asSpectator: boolean) => {
    const trimmedSessionId = nextSessionId.trim();
    if (!trimmedSessionId) return;
    const params = new URLSearchParams(location.search);
    params.set('session', trimmedSessionId);
    if (asSpectator) {
      params.set('spectator', '1');
    } else {
      params.delete('spectator');
    }
    navigate(
      {
        pathname: location.pathname,
        search: buildControlSearch(vehicle, {
          sessionId: trimmedSessionId,
          spectator: asSpectator,
        }),
      },
      { replace: false }
    );
  };

  const handleLeaveCoopSession = () => {
    const params = new URLSearchParams(location.search);
    params.delete('session');
    params.delete('spectator');
    navigate(
      {
        pathname: location.pathname,
        search: buildControlSearch(vehicle),
      },
      { replace: false }
    );
  };

  const handleClearSharedRoute = () => {
    if (!sessionId || !user?.id) return;
    sendClientMessage({
      type: 'coop_plan_clear',
      sessionId,
      userId: user.id,
    });
  };

  const handleCopyInvite = async () => {
    if (!inviteUrl || typeof navigator === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(inviteUrl);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 1500);
  };

  const handleEndSession = async () => {
    if (!vehicle || !user) {
      navigate(getHomeRoute(user?.role), { replace: true });
      return;
    }

    try {
      await releaseVehicle(vehicle.id);
      const timestamp = new Date().toISOString();
      void appendLog({
        id: `log-${Date.now()}`,
        userId: user.id,
        username: user.username,
        action: 'vehicle_unselected',
        details: `Ended session with vehicle ${vehicle.model} (${vehicle.id})`,
        timestamp,
      });
      void enqueueRecord({
        ts: Date.now(),
        userId: user.id,
        username: user.username,
        vehicleId: vehicle.id,
        action: 'vehicle_unselected',
        details: `Ended session with vehicle ${vehicle.model} (${vehicle.id})`,
      });
    } finally {
      clearLastVehicleSelection(user.id);
      navigate(getHomeRoute(user.role), { replace: true });
    }
  };

  if (isFocusMap) {
    return <FocusMapView />;
  }

  if (isFocusVideo) {
    return (
      <div className="min-h-screen bg-background p-4">
        <Suspense fallback={<ControllerPanelFallback title="Video" />}>
          <VideoPanel
            signalingUrl={getDefaultSignalingUrl()}
            roomId={roomId}
            viewerId={viewerId}
            className="h-[calc(100vh-2rem)]"
            videoClassName="h-full min-h-0 flex-1"
          />
        </Suspense>
      </div>
    );
  }

  if (isFocusControl) {
    return (
      <div className="min-h-screen bg-background p-4">
        <ControllerVisualizerPanel
          inputPaused={inputPaused}
          onToggleInputPaused={() => setInputPaused((prev) => !prev)}
          visualizerRef={visualizerRef}
          visualizerContainerRef={visualizerContainerRef}
          visualizerHeight={visualizerHeight}
          visualizerMaxHeight={visualizerMaxHeight}
          onLoad={sendVisualizerMaxHeight}
        />
      </div>
    );
  }

  if (isFocusChat) {
    return (
      <div className="min-h-screen bg-background p-4">
        <ControllerChatPanel
          sessionId={sessionId}
          inviteUrl={inviteUrl}
          inviteCopied={inviteCopied}
          isCoopHost={isCoopHost}
          participants={coopParticipants}
          messages={coopState.messages}
          terminalOutput={terminalOutput}
          sharedPlan={coopState.sharedPlan}
          currentUserId={user?.id}
          coopVehicleId={vehicleId}
          className="h-[calc(100vh-2rem)] max-h-none min-h-[calc(100vh-2rem)]"
          onSendChat={handleSendCoopMessage}
          onHostSession={handleStartCoopSession}
          onJoinSession={handleJoinCoopSession}
          onLeaveSession={handleLeaveCoopSession}
          onCopyInvite={handleCopyInvite}
          onClearRoute={handleClearSharedRoute}
          onClearChat={handleClearCoopMessages}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_12%_8%,rgba(56,189,248,0.12),transparent_40%),radial-gradient(circle_at_88%_4%,rgba(34,197,94,0.12),transparent_34%),hsl(var(--background))]">
      <OverlayModal
        open={shouldShowMissionOverlay}
        title={missionPrompt === 'confirm' ? 'Confirm mission' : 'Select a mission'}
        onClose={cancelMissionPrompt}
        maxWidthClassName="max-w-xl"
      >
        {missionPrompt === 'select' && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              No mission is active. Create one or choose an existing plan before enabling auto mode.
            </div>
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                onClick={() => cycleMissionSelection(-1)}
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
                onClick={() => cycleMissionSelection(1)}
                aria-label="Next mission"
                className="absolute right-0 top-1/2 -translate-y-1/2"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => navigate(`/control?vehicleId=${encodeURIComponent(vehicle?.id || '')}&focus=map`)}
              >
                Open Mission Planner
              </Button>
              <Button size="sm" variant="outline" onClick={refreshMissions}>
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
                onClick={() => cycleMissionSelection(-1)}
                aria-label="Previous mission"
                className="absolute left-0 top-1/2 -translate-y-1/2"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => cycleMissionSelection(1)}
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
              <Button size="sm" onClick={() => confirmMission(pendingMission)}>
                Confirm [X]
              </Button>
              <Button size="sm" variant="outline" onClick={cancelMissionPrompt}>
                Cancel [O]
              </Button>
            </div>
          </div>
        )}
      </OverlayModal>
      <OverlayModal
        open={insightOverlay === 'user'}
        title="User"
        onClose={() => setInsightOverlay(null)}
        maxWidthClassName="max-w-2xl"
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold">
                {userInitials}
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <UserIcon className="size-4 text-muted-foreground" />
                  <span>{user?.username || 'Unknown'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="size-3" />
                  <span>{user?.email || 'No email'}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setUserAvatarEditOpen((prev) => !prev)}>
                <Camera className="mr-2 size-4" />
                Avatar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setUserEditOpen((prev) => !prev)}>
                <Pencil className="mr-2 size-4" />
                Edit
              </Button>
            </div>
          </div>

          {userAvatarEditOpen && (
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Camera className="size-3" />
                <span>Avatar upload is available in profile settings.</span>
              </div>
            </div>
          )}

          {userEditOpen && (
            <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Display name</label>
                <Input value={userDraftName} onChange={(event) => setUserDraftName(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Email</label>
                <Input value={userDraftEmail} onChange={(event) => setUserDraftEmail(event.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setUserEditOpen(false)}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setUserEditOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Activity className="size-3" />
                <span>Drive mode</span>
              </div>
              <div className="mt-2 text-sm font-semibold">{driveMode === 'auto' ? 'Auto' : 'Manual'}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="size-3" />
                <span>Control lease</span>
              </div>
              <div className="mt-2 text-sm font-semibold">{controlLeaseId ? 'Active' : 'Missing'}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Battery className="size-3" />
                <span>Vehicle battery</span>
              </div>
              <div className="mt-2 text-sm font-semibold">{vehicle?.charge ?? 0}%</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MapPin className="size-3" />
                <span>Distance</span>
              </div>
              <div className="mt-2 text-sm font-semibold">{distanceLabel}</div>
              <div className="mt-1 text-xs text-muted-foreground">{activeDaysLabel}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Activity className="size-3" />
                <span>Top speed</span>
              </div>
              <div className="mt-2 text-sm font-semibold">{maxSpeedLabel}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Terminal className="size-3" />
                <span>Active hours</span>
              </div>
              <div className="mt-2 text-sm font-semibold">{activeHoursLabel}</div>
            </div>
          </div>
        </div>
      </OverlayModal>

      <OverlayModal
        open={insightOverlay === 'diagnostics'}
        title="Live Diagnostics"
        onClose={() => setInsightOverlay(null)}
        maxWidthClassName="max-w-2xl"
      >
        <div className="grid gap-3">
          <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Server className="size-3" />
              <span>Connections</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-2">
                {controlWsState === 'Connected' ? <Wifi className="size-4 text-emerald-500" /> : <WifiOff className="size-4 text-red-500" />}
                Control WS
              </span>
              <span className="flex items-center gap-2">
                {telemetryWsState === 'Connected' ? <Wifi className="size-4 text-emerald-500" /> : <WifiOff className="size-4 text-red-500" />}
                Telemetry WS
              </span>
              <span className="flex items-center gap-2">
                {deviceOnline ? <Wifi className="size-4 text-emerald-500" /> : <WifiOff className="size-4 text-red-500" />}
                Device
              </span>
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Cpu className="size-3" />
              <span>Device</span>
            </div>
            <div className="grid gap-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">GPS</span>
                <span>{locationFeed.isConnected ? 'Linked' : 'Offline'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Battery</span>
                <span>{batteryLevel !== null ? `${batteryLevel}%` : 'n/a'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Firmware</span>
                <span>{deviceStatus.fw || 'n/a'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">IP</span>
                <span>{deviceStatus.ip || 'n/a'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last seen</span>
                <span>{lastSeenLabel}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Activity className="size-3" />
              <span>Telemetry</span>
            </div>
            <div className="grid gap-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Samples</span>
                <span>{serverTelemetryAck.received}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last ACK</span>
                <span>
                  {serverTelemetryAck.lastAckTs
                    ? new Date(serverTelemetryAck.lastAckTs).toLocaleTimeString()
                    : 'n/a'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </OverlayModal>
      <OverlayModal
        open={deviceOverlayOpen}
        title="Device Details"
        onClose={() => setDeviceOverlayOpen(false)}
      >
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Vehicle Name</span>
            <span>{vehicle?.model || 'Unknown'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Vehicle ID</span>
            <span>{vehicle?.id || 'n/a'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Lease ID</span>
            <span>{controlLeaseId || 'None'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Location</span>
            <span>{vehicle?.location || 'n/a'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Battery</span>
            <span>{typeof vehicle?.charge === 'number' ? `${vehicle.charge}%` : 'n/a'}</span>
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
            <span>{gamepadState.connected || hidDevice ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Battery</span>
            <span>
              {typeof controllerInfo.battery === 'number'
                ? `${Math.round(controllerInfo.battery * 100)}%`
                : batteryLevel !== null
                  ? `${Math.round(batteryLevel * 100)}%`
                  : 'n/a'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Mapping</span>
            <span>{controllerInfo.mapping || 'standard'}</span>
          </div>
        </div>
      </OverlayModal>
      <aside className="fixed left-0 top-1/2 z-40 -translate-y-1/2">
        <div className="relative w-14">
          <div className="rounded-r-2xl border border-slate-700/50 bg-slate-900/45 p-2 shadow-[0_20px_52px_rgba(2,6,23,0.6)] ring-1 ring-white/10 backdrop-blur-2xl dark:border-white/15 dark:bg-slate-900/45 dark:ring-white/10">
            <div className="flex flex-col gap-2">
              <Button
                size="icon"
                variant="outline"
                onClick={openMapWindow}
                aria-label="Open map"
                title="Open map"
                className="rounded-full border-emerald-400/80 bg-emerald-500/75 text-white hover:bg-emerald-500/90 dark:border-emerald-500/60 dark:bg-emerald-700/45 dark:hover:bg-emerald-700/60"
              >
                <MapIcon className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={openVideoWindow}
                aria-label="Open video in new page"
                title="Open video in new page"
                className="rounded-full border-emerald-400/80 bg-emerald-500/75 text-white hover:bg-emerald-500/90 dark:border-emerald-500/60 dark:bg-emerald-700/45 dark:hover:bg-emerald-700/60"
              >
                <VideoIcon className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={openChatWindow}
                aria-label="Open chat in new page"
                title="Open chat in new page"
                className="rounded-full border-emerald-400/80 bg-emerald-500/75 text-white hover:bg-emerald-500/90 dark:border-emerald-500/60 dark:bg-emerald-700/45 dark:hover:bg-emerald-700/60"
              >
                <MessageSquare className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={openControlWindow}
                aria-label="Open control in new page"
                title="Open control in new page"
                className="rounded-full border-emerald-400/80 bg-emerald-500/75 text-white hover:bg-emerald-500/90 dark:border-emerald-500/60 dark:bg-emerald-700/45 dark:hover:bg-emerald-700/60"
              >
                <Gamepad2 className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>
      {(!modules.video || !modules.visualizer || !modules.stream) && (
        <aside className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
          <div className="rounded-full border border-slate-700/50 bg-slate-900/55 px-3 py-2 shadow-[0_16px_40px_rgba(2,6,23,0.5)] ring-1 ring-white/10 backdrop-blur-2xl dark:border-white/15 dark:bg-slate-900/45 dark:ring-white/10">
            <div className="flex items-center gap-2">
              {!modules.video && (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => toggleModule('video')}
                  aria-label="Show video panel"
                  title="Show video panel"
                  className="rounded-full"
                >
                  <VideoIcon className="size-4" />
                </Button>
              )}
              {!modules.visualizer && (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => toggleModule('visualizer')}
                  aria-label="Show controller"
                  title="Show controller"
                  className="rounded-full"
                >
                  <Gamepad2 className="size-4" />
                </Button>
              )}
              {!modules.stream && (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => toggleModule('stream')}
                  aria-label="Show chat"
                  title="Show chat"
                  className="rounded-full"
                >
                  <MessageSquare className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </aside>
      )}
      <header className="sticky top-0 z-[140] border-b border-border/80 bg-card/92 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">IVY</h1>
            <p className="truncate text-xs text-muted-foreground">
              {vehicle
                ? `${user?.username || 'Unknown'}, ${vehicle.model} (${vehicle.id}), lease ${controlLeaseId ? 'active' : 'missing'}`
                : `${user?.username || 'Unknown'}, no vehicle, lease missing`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 border-r border-border/70 pr-2">
              <RealtimeIndicatorsRow
                deviceOnline={deviceOnline}
                gamepadConnected={Boolean(gamepadState.connected || hidDevice)}
                driveMode={driveMode}
                onDeviceClick={() => setDeviceOverlayOpen(true)}
                onControllerClick={() => setControllerOverlayOpen(true)}
                onAutoClick={handleAutoIndicatorClick}
                compact
              />
            </div>
            <ControllerQuickMenu
              open={navOpen}
              onToggle={() => setNavOpen((prev) => !prev)}
              onSelect={handleOpenInsight}
            />
            <Button onClick={toggleTheme} variant="outline" size="icon" title="Toggle theme" aria-label="Toggle theme">
              {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </Button>
            <Button
              onClick={() => void handleEndSession()}
              variant="outline"
              size="icon"
              title="End session"
              aria-label="End session"
            >
              <Power className="size-4" />
            </Button>
            <Button onClick={handleLogout} variant="outline" size="icon" title="Logout" aria-label="Logout">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

        <main className="container mx-auto px-4 py-4">
          <Tabs value={activeMainTab} onValueChange={(v) => setActiveMainTab(v as 'ops' | 'status' | 'stream')} className="space-y-4">

            {activeMainTab === 'ops' && (
            <TabsContent value="ops" className="space-y-4">
              <Card className="border-border/70 bg-card/90 lg:min-h-[calc(100vh-11rem)]">
                <CardHeader className="p-0" />
                <CardContent className="space-y-2 pt-0 lg:flex lg:h-full lg:flex-col">
                  <div className="grid grid-cols-1 items-stretch gap-4 lg:flex-1 lg:grid-cols-3">
                    {modules.video && (
                      <div className="relative lg:col-span-2">
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => toggleModule('video')}
                          aria-label="Hide video panel"
                          title="Hide video panel"
                          className="absolute right-3 top-3 z-10 h-7 w-7 rounded-full bg-card/80 backdrop-blur"
                        >
                          <Minimize2 className="size-3.5" />
                        </Button>
                        <Suspense fallback={<ControllerPanelFallback title="Video" />}>
                          <VideoPanel
                            signalingUrl={getDefaultSignalingUrl()}
                            roomId={roomId}
                            viewerId={viewerId}
                            className="flex h-full flex-col"
                            videoClassName="h-full min-h-[21rem] lg:min-h-[23rem] flex-1"
                          />
                        </Suspense>
                      </div>
                    )}

                    <div className="flex h-full min-h-[21rem] flex-col lg:col-span-1">
                      {modules.stream && (
                        <ControllerChatPanel
                          sessionId={sessionId}
                          inviteUrl={inviteUrl}
                          inviteCopied={inviteCopied}
                          isCoopHost={isCoopHost}
                          participants={coopParticipants}
                          messages={coopState.messages}
                          terminalOutput={terminalOutput}
                          sharedPlan={coopState.sharedPlan}
                          currentUserId={user?.id}
                          coopVehicleId={vehicleId}
                          className="flex h-full min-h-[21rem] flex-1 flex-col"
                          onHide={() => toggleModule('stream')}
                          onSendChat={handleSendCoopMessage}
                          onHostSession={handleStartCoopSession}
                          onJoinSession={handleJoinCoopSession}
                          onLeaveSession={handleLeaveCoopSession}
                          onCopyInvite={handleCopyInvite}
                          onClearRoute={handleClearSharedRoute}
                          onClearChat={handleClearCoopMessages}
                        />
                      )}
                    </div>
                </div>

                {modules.visualizer && (
                  <div>
                    <ControllerVisualizerPanel
                      inputPaused={inputPaused}
                      onToggleInputPaused={() => setInputPaused((prev) => !prev)}
                      onHide={() => toggleModule('visualizer')}
                      visualizerRef={visualizerRef}
                      visualizerContainerRef={visualizerContainerRef}
                      visualizerHeight={visualizerHeight}
                      visualizerMaxHeight={visualizerMaxHeight}
                      onLoad={sendVisualizerMaxHeight}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}

          {activeMainTab === 'status' && (
          <TabsContent value="status">
            <Card className="border-border/70 bg-card/90">
              <CardHeader>
                <CardTitle className="text-base">Status</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="vehicle" className="space-y-4">
                  <TabsList className="grid w-full max-w-lg grid-cols-3">
                    <TabsTrigger value="vehicle">Vehicle Info</TabsTrigger>
                    <TabsTrigger value="controller">Controller Status</TabsTrigger>
                    <TabsTrigger value="websocket">WebSocket URL</TabsTrigger>
                  </TabsList>

                  <TabsContent value="vehicle" className="space-y-3 text-sm">
                    <div><div className="text-muted-foreground">Model</div><div className="font-medium">{vehicle?.model}</div></div>
                    <div><div className="text-muted-foreground">ID</div><div className="font-mono">{vehicle?.id}</div></div>
                    <div><div className="text-muted-foreground">Location</div><div>{vehicle?.location}</div></div>
                    <div>
                      <div className="text-muted-foreground">Battery</div>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-muted">
                          <div
                            className={`h-2 rounded-full ${(vehicle?.charge || 0) > 60 ? 'bg-green-500' : (vehicle?.charge || 0) > 30 ? 'bg-yellow-500' : 'bg-red-500'}`}
                            style={{ width: `${vehicle?.charge || 0}%` }}
                          />
                        </div>
                        <span>{vehicle?.charge || 0}%</span>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="controller" className="space-y-4">
                    <ControllerStatusPanel
                      connected={gamepadState.connected}
                      driveMode={driveMode}
                      pauseLatched={pauseLatched}
                      estopLatched={estopLatched}
                      inputPaused={inputPaused}
                      serverTelemetryAck={serverTelemetryAck}
                      hapticsSupported={hapticsSupported}
                      onTogglePause={() => setPauseLatched((prev) => !prev)}
                      onClearEstop={() => setEstopLatched(false)}
                      onTriggerHaptics={triggerHaptics}
                    />
                    <ControllerMissionPanel
                      driveMode={driveMode}
                      activeMissionId={activeMissionId}
                      draftMission={draftMission}
                      missions={missions}
                      selectedMissionId={selectedMissionId}
                      mapRegionLabel={mapRegionLabel}
                      vehicleId={vehicle?.id}
                      resolveSelectedMission={resolveSelectedMission}
                      onSelectMission={(value) => setSelectedMissionId(value)}
                      onRefreshMissions={() => void refreshMissions()}
                      onRequestAutoMode={requestAutoMode}
                      onCancelMissionPrompt={cancelMissionPrompt}
                      onStopVehicle={stopVehicleNow}
                      onRetraceMission={sendRetraceMission}
                    />
                    <ControllerDiagnosticsPanel
                      batteryLabel={batteryLevel !== null ? `${batteryLevel}%` : 'Unavailable'}
                      hidSupported={hidSupported}
                      hidSecure={hidSecure}
                      canUseHid={canUseHid}
                      hidDeviceConnected={Boolean(hidDevice)}
                      hidProfile={hidProfile}
                      lightbarColor={lightbarColor}
                      onSetLightbarColor={setLightbarColor}
                      onConnectHid={handleConnectHid}
                      onDisconnectHid={handleDisconnectHid}
                      onApplyLightbar={() => {
                        if (hidDevice) sendLightbarColor(hidDevice, lightbarColor, hidProfile || 'unknown');
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="websocket" className="space-y-3">
                    <ControllerTransportSettings
                      wsUrl={wsUrl}
                      wsUrlInput={wsUrlInput}
                      onChange={setWsUrlInput}
                      onSave={handleWsSave}
                      onReset={handleWsClear}
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>
          )}

          {activeMainTab === 'stream' && (
          <TabsContent value="stream">
            <ControllerChatPanel
              sessionId={sessionId}
              inviteUrl={inviteUrl}
              inviteCopied={inviteCopied}
              isCoopHost={isCoopHost}
              participants={coopParticipants}
              messages={coopState.messages}
              terminalOutput={terminalOutput}
              sharedPlan={coopState.sharedPlan}
              currentUserId={user?.id}
              coopVehicleId={vehicleId}
              onSendChat={handleSendCoopMessage}
              onHostSession={handleStartCoopSession}
              onJoinSession={handleJoinCoopSession}
              onLeaveSession={handleLeaveCoopSession}
              onCopyInvite={handleCopyInvite}
              onClearRoute={handleClearSharedRoute}
              onClearChat={handleClearCoopMessages}
            />
          </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}




