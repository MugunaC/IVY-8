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
import { CoopChatDock } from '@/app/components/realtime/CoopChatDock';
import { ControllerQuickMenu } from '@/app/components/realtime/control/ControllerQuickMenu';
import { GoogleMapsLocationIcon } from '@/app/components/realtime/GoogleMapsLocationIcon';
import {
  buildMissionPayloadFromPlan,
  formatDistanceKm,
  formatHours,
  formatMissionSummary,
  formatSpeedKmh,
  resolveLatestMission,
} from '@/app/components/realtime/missionUtils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { DataStreamPanel } from '@/app/components/realtime/DataStreamPanel';
import { ControllerVisualizerPanel } from '@/app/components/realtime/ControllerVisualizerPanel';
import { useVehicleLocationFeed } from '@/app/hooks/useVehicleLocationFeed';
import { usePresence } from '@/app/hooks/usePresence';
import { useReconnectingWebSocket } from '@/app/hooks/useReconnectingWebSocket';
import { enqueueRecord, enqueueTelemetry } from '@/app/data/inputStore';
import { getMissions } from '@/app/data/missionsRepo';
import { readJson, readString, STORAGE_KEYS } from '@/app/data/storage';
import { registerSecondaryWindow } from '@/app/utils/secondaryWindows';
import { isPerfEnabled } from '@/app/utils/perf';
import {
  getDefaultControlWsUrl,
  getDefaultLocationWsUrl,
  getDefaultSignalingUrl,
  getDefaultTelemetryWsUrl,
} from '@/app/utils/wsUrls';
import { appendLog } from '@/app/data/logsRepo';
import { getVehicles, markVehicleInUse, releaseVehicle } from '@/app/data/vehiclesRepo';
import {
  clearLastVehicleSelection,
  clearWsUrlOverride,
  getWsUrlOverride,
  setWsUrlOverride,
} from '@/app/data/settingsRepo';
import { clientMessageSchema, serverMessageSchema, PROTOCOL_VERSION } from '@shared/protocol';
import type { CoopStatePayload, MissionPlan, TelemetryPayload, WsServerMessage } from '@shared/types';
import {
  Car,
  Bot,
  ChevronLeft,
  ChevronRight,
  Camera,
  Gamepad2,
  LogOut,
  Map as MapIcon,
  MapPin,
  Minimize2,
  Moon,
  Sun,
  User as UserIcon,
  Pencil,
  Mail,
  ShieldCheck,
  Activity,
  Users,
  MessagesSquare,
  Copy,
  Link2,
  Route,
  Mic,
  Wifi,
  WifiOff,
  Cpu,
  Battery,
  Server,
  Terminal,
  Video as VideoIcon,
} from 'lucide-react';

const MapPanel = lazy(async () => {
  const mod = await import('@/app/components/realtime/MapPanel');
  return { default: mod.MapPanel };
});

const VideoPanel = lazy(async () => {
  const mod = await import('@/app/components/realtime/VideoPanel');
  return { default: mod.VideoPanel };
});

interface GamepadState {
  buttons: number[];
  axes: number[];
  connected: boolean;
}

interface ModulesState {
  map: boolean;
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

const AXIS_DEADZONE = 0.08;
const ANALOG_EPS = 0.01;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, decimals: number) => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};
const normalizeAxis = (value: number) => {
  const deadzoned = Math.abs(value) < AXIS_DEADZONE ? 0 : value;
  return round(clamp(deadzoned, -1, 1), 2);
};
const normalizeButton = (value: number) => round(clamp(value, 0, 1), 2);
const toRad = (value: number) => (value * Math.PI) / 180;
const haversineMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const radius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const calc = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(calc)));
};
const hasStateChanged = (prev: TelemetryPayload | null, next: TelemetryPayload) => {
  if (!prev) return true;
  if (prev.buttons.length !== next.buttons.length || prev.axes.length !== next.axes.length) return true;
  for (let i = 0; i < prev.buttons.length; i += 1) {
    if (Math.abs(prev.buttons[i] - next.buttons[i]) > ANALOG_EPS) return true;
  }
  for (let i = 0; i < prev.axes.length; i += 1) {
    if (Math.abs(prev.axes[i] - next.axes[i]) > ANALOG_EPS) return true;
  }
  return false;
};
const hasGamepadUiChanged = (
  prev: GamepadState,
  nextButtons: number[],
  nextAxes: number[],
  connected: boolean
) => {
  if (prev.connected !== connected) return true;
  if (prev.buttons.length !== nextButtons.length || prev.axes.length !== nextAxes.length) return true;
  for (let i = 0; i < prev.buttons.length; i += 1) {
    if (Math.abs(prev.buttons[i] - nextButtons[i]) > ANALOG_EPS) return true;
  }
  for (let i = 0; i < prev.axes.length; i += 1) {
    if (Math.abs(prev.axes[i] - nextAxes[i]) > ANALOG_EPS) return true;
  }
  return false;
};

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
  const isFocusedDisplay = isFocusMap || isFocusVideo || isFocusControl;

  const [gamepadState, setGamepadState] = useState<GamepadState>({
    buttons: Array(18).fill(0),
    axes: Array(4).fill(0),
    connected: false,
  });
  const [inputPaused, setInputPaused] = useState(false);
  const [pauseLatched, setPauseLatched] = useState(false);
  const [estopLatched, setEstopLatched] = useState(false);
  const [driveMode, setDriveMode] = useState<'manual' | 'auto'>('manual');
  const [followVehicleMap, setFollowVehicleMap] = useState(true);
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<{
    online: boolean;
    lastSeenMs: number;
    deviceId?: string;
    ip?: string;
    fw?: string;
  }>({ online: false, lastSeenMs: 0 });
  const [deviceOverlayOpen, setDeviceOverlayOpen] = useState(false);
  const [controllerOverlayOpen, setControllerOverlayOpen] = useState(false);
  const [controllerInfo, setControllerInfo] = useState<{ id: string; mapping?: string; battery?: number | null }>({
    id: 'Unknown',
  });
  const [missions, setMissions] = useState<MissionPlan[]>([]);
  const [draftMission, setDraftMission] = useState<MissionPlan | null>(null);
  const [selectedMissionId, setSelectedMissionId] = useState<string>('');
  const [pendingMission, setPendingMission] = useState<MissionPlan | null>(null);
  const [missionPrompt, setMissionPrompt] = useState<'none' | 'select' | 'confirm'>('none');
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [hidSupported, setHidSupported] = useState(false);
  const [hidSecure, setHidSecure] = useState(false);
  const [hidDevice, setHidDevice] = useState<HIDDevice | null>(null);
  const [hidProfile, setHidProfile] = useState<'ds4' | 'dualsense' | 'unknown' | null>(null);
  const [lightbarColor, setLightbarColor] = useState('#4f46e5');
  const [hapticsSupported, setHapticsSupported] = useState<boolean | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [serverTelemetryAck, setServerTelemetryAck] = useState<{
    received: number;
    lastAckTs: number | null;
  }>({ received: 0, lastAckTs: null });
  const [visualizerHeight, setVisualizerHeight] = useState(700);
  const [visualizerMaxHeight, setVisualizerMaxHeight] = useState(700);
  const [routeFocusSignal, setRouteFocusSignal] = useState(0);
  const [mapRegionLabel, setMapRegionLabel] = useState<string>('');
  const [modules, setModules] = useState<ModulesState>({
    map: true,
    video: true,
    visualizer: true,
    stream: true,
  });
  const [activeMainTab, setActiveMainTab] = useState<'ops' | 'status' | 'stream'>('ops');
  const [navOpen, setNavOpen] = useState(false);
  const [insightOverlay, setInsightOverlay] = useState<'user' | 'coop' | 'diagnostics' | null>(null);
  const [userEditOpen, setUserEditOpen] = useState(false);
  const [userAvatarEditOpen, setUserAvatarEditOpen] = useState(false);
  const [userDraftName, setUserDraftName] = useState('');
  const [userDraftEmail, setUserDraftEmail] = useState('');
  const [coopChatOpen, setCoopChatOpen] = useState(false);
  const [coopMessageInput, setCoopMessageInput] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const [coopState, setCoopState] = useState<CoopStatePayload>({
    sessionId: '',
    invitePath: '',
    participants: [],
    vehicles: [],
    messages: [],
    sharedRoute: null,
  });
  const [sessionStats, setSessionStats] = useState({
    totalDistanceM: 0,
    maxSpeedMps: 0,
    activeSeconds: 0,
    activeDays: 0,
  });

  const terminalRef = useRef<HTMLDivElement>(null);
  const visualizerRef = useRef<HTMLIFrameElement>(null);
  const visualizerContainerRef = useRef<HTMLDivElement>(null);
  const animationFrameId = useRef<number>();
  const wsRef = useRef<WebSocket | null>(null);
  const telemetryWsRef = useRef<WebSocket | null>(null);
  const telemetryPauseUntilRef = useRef(0);
  const lastPayloadRef = useRef<TelemetryPayload | null>(null);
  const controlSeqRef = useRef(0);
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
  const missionPromptRef = useRef<'none' | 'select' | 'confirm'>('none');
  const pendingMissionRef = useRef<MissionPlan | null>(null);
  const missionsRef = useRef<MissionPlan[]>([]);
  const selectedMissionIdRef = useRef<string>('');
  const activeMissionIdRef = useRef<string | null>(null);
  const draftMissionRef = useRef<MissionPlan | null>(null);
  const prevMissionAxisRef = useRef(0);
  const lastMissionAxisSwitchRef = useRef(0);
  const driveModeRef = useRef<'manual' | 'auto'>('manual');
  const lastAutoControlSentRef = useRef(0);
  const hapticsSupportedRef = useRef<boolean | null>(null);
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
  const viewerId = user?.id || 'anon-viewer';
  const roomId = useMemo(() => `vehicle-room-${vehicleId}`, [vehicleId]);
  const canUseHid = hidSupported && hidSecure;
  const coopParticipants = coopState.participants;
  const coopMessages = coopState.messages;
  const coopVehicles = coopState.vehicles.filter((entry) => entry.vehicleId !== vehicleId);
  const sharedSessionRoute = coopState.sharedRoute?.route || null;
  const isCoopHost = Boolean(user?.id && coopState.hostUserId === user.id);
  const driverCount = coopParticipants.filter((entry) => entry.role !== 'spectator').length;
  const spectatorCount = coopParticipants.filter((entry) => entry.role === 'spectator').length;
  const inviteUrl =
    typeof window !== 'undefined' && coopState.invitePath
      ? `${window.location.origin}${coopState.invitePath}`
      : '';

  const { wsRef: controlWsRef, isConnected: isControlWsConnected } = useReconnectingWebSocket({
    url: wsUrl,
    onOpen: (ws) => {
      const hello = clientMessageSchema.safeParse({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        vehicleId,
      });
      if (hello.success) {
        ws.send(JSON.stringify(hello.data));
      }
      addTerminalLine('Control WebSocket connected to server');
    },
    onClose: () => {
      addTerminalLine('Control WebSocket disconnected; retrying...');
    },
    onError: () => {
      addTerminalLine('Control WebSocket connection error');
    },
    onMessage: (event) => {
      if (typeof event.data !== 'string') return;
      const parsed = parseServerMessage(event.data);
      if (!parsed) return;
      if (parsed.type === 'cpp') {
        addTerminalLine(`Server: ${parsed.text}`);
      }
      if (parsed.type === 'input_ack') {
        setServerTelemetryAck({ received: parsed.received, lastAckTs: parsed.ts });
      }
      if (parsed.type === 'device_status' && parsed.vehicleId === vehicleId) {
        setDeviceOnline(parsed.online);
        setDeviceStatus({
          online: parsed.online,
          lastSeenMs: parsed.lastSeenMs,
          deviceId: parsed.deviceId,
          ip: parsed.ip,
          fw: parsed.fw,
        });
        if (parsed.online && lastDeviceOnlineRef.current !== true) {
          addTerminalLine(`Device heartbeat received for ${vehicleId}.`);
        }
        lastDeviceOnlineRef.current = parsed.online;
      }
      if (parsed.type === 'coop_state' && (!sessionId || parsed.payload.sessionId === sessionId)) {
        setCoopState(parsed.payload);
      }
      if (parsed.type === 'coop_chat' && (!sessionId || parsed.payload.sessionId === sessionId)) {
        setCoopState((prev) => ({
          ...prev,
          messages: [...prev.messages, parsed.payload].slice(-50),
        }));
      }
      if (parsed.type === 'error') {
        addTerminalLine(`Server error: ${parsed.message}`);
        if (parsed.message.includes(`Device heartbeat timed out for ${vehicleId}`)) {
          setDeviceOnline(false);
          setDeviceStatus((prev) => ({
            ...prev,
            online: false,
            lastSeenMs: Date.now(),
          }));
          lastDeviceOnlineRef.current = false;
        }
      }
    },
  });

  const { wsRef: telemetryWsRefHook } = useReconnectingWebSocket({
    url: telemetryWsUrl,
    onOpen: (ws) => {
      const hello = clientMessageSchema.safeParse({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        vehicleId,
      });
      if (hello.success) {
        ws.send(JSON.stringify(hello.data));
      }
      setServerTelemetryAck({ received: 0, lastAckTs: null });
      addTerminalLine('Telemetry WebSocket connected to server');
    },
    onClose: () => {
      addTerminalLine('Telemetry WebSocket disconnected; retrying...');
    },
    onError: () => {
      addTerminalLine('Telemetry WebSocket connection error');
    },
    onMessage: (event) => {
      if (typeof event.data !== 'string') return;
      const parsed = parseServerMessage(event.data);
      if (!parsed) return;
      if (parsed.type === 'slow_down') {
        telemetryPauseUntilRef.current = Date.now() + parsed.retryAfterMs;
      }
    },
  });

  wsRef.current = controlWsRef.current;
  telemetryWsRef.current = telemetryWsRefHook.current;

  const [controlLeaseId, setControlLeaseId] = useState<string | null>(vehicle?.controlLeaseId ?? null);

  useEffect(() => {
    setCoopState({
      sessionId,
      invitePath: '',
      participants: [],
      vehicles: [],
      messages: [],
      sharedRoute: null,
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
      map: isFocusMap,
      video: isFocusVideo,
      visualizer: isFocusControl,
      stream: isFocusControl,
    });
  }, [isFocusedDisplay, isFocusMap, isFocusVideo, isFocusControl]);

  useEffect(() => {
    if (isPresenceOwner) return;
    if (presence.controlLeaseId !== undefined && presence.controlLeaseId !== controlLeaseId) {
      setControlLeaseId(presence.controlLeaseId ?? null);
    }
  }, [presence.controlLeaseId, controlLeaseId, isPresenceOwner]);

  useEffect(() => {
    updatePresence({ controlLeaseId });
  }, [controlLeaseId, updatePresence]);

  useEffect(() => {
    if (isPresenceOwner) return;
    if (presence.deviceOnline !== undefined && presence.deviceOnline !== deviceOnline) {
      setDeviceOnline(presence.deviceOnline);
    }
  }, [presence.deviceOnline, deviceOnline, isPresenceOwner]);

  useEffect(() => {
    updatePresence({ deviceOnline });
  }, [deviceOnline, updatePresence]);

  useEffect(() => {
    updatePresence({ gamepadConnected: gamepadState.connected });
  }, [gamepadState.connected, updatePresence]);

  useEffect(() => {
    const readControllerInfo = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad =
        Array.from(pads).find((item): item is Gamepad => Boolean(item && item.connected)) || null;
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
    return () => {
      window.clearInterval(interval);
    };
  }, [gamepadState.connected, hidDevice]);

  const parseServerMessage = (raw: string): WsServerMessage | null => {
    try {
      const parsed = JSON.parse(raw);
      const result = serverMessageSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  };

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

  const formatWaypointPreview = (lat: number, lng: number) =>
    `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

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
  const selectedMissionRoute = useMemo(() => {
    if (!selectedMission) return null;
    if (selectedMission.route && selectedMission.route.coordinates.length >= 2) {
      return selectedMission.route;
    }
    return null;
  }, [selectedMission]);
  const displayWaypoints = useMemo(() => {
    if (pendingMission?.waypoints?.length) return pendingMission.waypoints;
    if (selectedMission?.waypoints?.length) return selectedMission.waypoints;
    if (draftMission?.waypoints?.length) return draftMission.waypoints;
    return [];
  }, [draftMission?.waypoints, pendingMission?.waypoints, selectedMission?.waypoints]);

  useEffect(() => {
    if (!selectedMission || !selectedMission.waypoints || selectedMission.waypoints.length < 2) return;
    setFollowVehicleMap(false);
    setRouteFocusSignal((prev) => prev + 1);
  }, [selectedMission]);

  useEffect(() => {
    if (!selectedMissionRoute) return;
    setFollowVehicleMap(false);
    setRouteFocusSignal((prev) => prev + 1);
  }, [selectedMissionRoute]);

  const shouldShowMissionOverlay =
    missionPrompt !== 'none' && Boolean(vehicle) && !location.pathname.startsWith('/admin');

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
    missionPromptRef.current = missionPrompt;
  }, [missionPrompt]);

  useEffect(() => {
    pendingMissionRef.current = pendingMission;
  }, [pendingMission]);

  useEffect(() => {
    missionsRef.current = missions;
  }, [missions]);

  useEffect(() => {
    selectedMissionIdRef.current = selectedMissionId;
  }, [selectedMissionId]);

  useEffect(() => {
    activeMissionIdRef.current = activeMissionId;
  }, [activeMissionId]);

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
    if (!vehicle) navigate('/user');
  }, [vehicle, navigate]);

  useEffect(() => {
    let cancelled = false;
    const hydrateLease = async () => {
      try {
        const vehicles = await getVehicles();
        const match = vehicles.find((item) => item.id === vehicleId);
        if (cancelled) return;
        setControlLeaseId(match?.controlLeaseId ?? null);
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to fetch control lease:', error);
        }
      }
    };
    if (vehicle?.controlLeaseId) {
      setControlLeaseId(vehicle.controlLeaseId);
      return;
    }
    void hydrateLease();
    return () => {
      cancelled = true;
    };
  }, [vehicle?.controlLeaseId, vehicleId]);

  useEffect(() => {
    if (!vehicle || !user) return;
    let cancelled = false;
    const acquireLease = async () => {
      try {
        const vehicles = await markVehicleInUse(vehicle.id, user.username, user.id);
        if (cancelled) return;
        const match = vehicles.find((item) => item.id === vehicle.id);
        setControlLeaseId(match?.controlLeaseId ?? null);
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to mark vehicle in use:', error);
        }
      }
    };
    void acquireLease();
    return () => {
      cancelled = true;
    };
  }, [vehicle, user]);

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

  useEffect(() => {
    if (isPresenceOwner) return;
    if (presence.driveMode && presence.driveMode !== driveMode) {
      setDriveMode(presence.driveMode);
    }
  }, [presence.driveMode, driveMode, isPresenceOwner]);

  useEffect(() => {
    updatePresence({ driveMode });
  }, [driveMode, updatePresence]);

  useEffect(() => {
    driveModeRef.current = driveMode;
  }, [driveMode]);

  useEffect(() => {
    if (!vehicle) return;

    const pollGamepad = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gamepad =
        Array.from(gamepads).find((pad): pad is Gamepad => Boolean(pad && pad.connected)) || null;
      const now = Date.now();
      if (gamepad) {
        const buttons = gamepad.buttons.map((button) =>
          normalizeButton(typeof button.value === 'number' ? button.value : button.pressed ? 1 : 0)
        );
        const axes = Array.from(gamepad.axes, (axis) => normalizeAxis(axis));
        const pausePressed = buttons[8] > 0.5;
        const modePressed = buttons[9] > 0.5;
        const confirmPressed = buttons[0] > 0.5;
        const cancelPressed = buttons[1] > 0.5;
        const estopPressed = buttons[16] > 0.5;
        const pauseRising = pausePressed && !prevPauseButtonRef.current;
        const modeRising = modePressed && !prevModeButtonRef.current;
        const confirmRising = confirmPressed && !prevConfirmButtonRef.current;
        const cancelRising = cancelPressed && !prevCancelButtonRef.current;
        const estopRising = estopPressed && !prevEstopButtonRef.current;

        if (pauseRising && !estopLatched) {
          setPauseLatched((prev) => !prev);
        }
        if (modeRising && !estopLatched) {
          if (driveModeRef.current === 'manual') {
            requestAutoMode();
          } else {
            setDriveMode('manual');
            setActiveMissionId(null);
            sendControlMode('manual');
            addTerminalLine('Drive mode set to MANUAL');
          }
        }
        if (confirmRising && missionPromptRef.current === 'confirm' && pendingMissionRef.current) {
          confirmMission(pendingMissionRef.current);
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
            void refreshMissions();
          }
        }
        if (cancelRising && missionPromptRef.current !== 'none') {
          cancelMissionPrompt();
        }
        if (estopRising) {
          setEstopLatched((prev) => {
            const next = !prev;
            if (next) {
              setPauseLatched(true);
            } else {
              setPauseLatched(false);
            }
            return next;
          });
        }

        prevPauseButtonRef.current = pausePressed;
        prevModeButtonRef.current = modePressed;
        prevConfirmButtonRef.current = confirmPressed;
        prevCancelButtonRef.current = cancelPressed;
        prevEstopButtonRef.current = estopPressed;

        const dpadRight = buttons[15] > 0.5;
        const dpadLeft = buttons[14] > 0.5;
        const dpadDir = dpadRight ? 1 : dpadLeft ? -1 : 0;
        if (missionPromptRef.current !== 'none' && dpadDir !== 0) {
          const nowMs = Date.now();
          if (nowMs - lastMissionAxisSwitchRef.current > 250 && dpadDir !== prevMissionAxisRef.current) {
            cycleMissionSelection(dpadDir as -1 | 1);
            lastMissionAxisSwitchRef.current = nowMs;
            prevMissionAxisRef.current = dpadDir;
          }
        }
        if (dpadDir === 0) {
          prevMissionAxisRef.current = 0;
        }

        // Throttle React state updates for UI (~15fps) to avoid 60fps re-renders; telemetry stays real-time
        if (now - lastGamepadUiUpdateRef.current >= GAMEPAD_UI_THROTTLE_MS) {
          lastGamepadUiUpdateRef.current = now;
          setGamepadState((prev) =>
            hasGamepadUiChanged(prev, buttons, axes, true) ? { buttons, axes, connected: true } : prev
          );

          const battery = (gamepad as any)?.battery?.level;
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

        const payload: TelemetryPayload = {
          buttons,
          axes,
          vehicleId: vehicle.id,
          leaseId: controlLeaseId ?? undefined,
        };
        const activeMode = driveModeRef.current;
        const slowDownUntil = telemetryPauseUntilRef.current;
        if (Date.now() < slowDownUntil) {
          prevPauseButtonRef.current = pausePressed;
          prevModeButtonRef.current = modePressed;
          prevConfirmButtonRef.current = confirmPressed;
          prevCancelButtonRef.current = cancelPressed;
          prevEstopButtonRef.current = estopPressed;
          animationFrameId.current = requestAnimationFrame(pollGamepad);
          return;
        }
        if (!pausedRef.current && hasStateChanged(lastPayloadRef.current, payload)) {
          lastPayloadRef.current = payload;
          sendClientMessage({ type: 'input', payload, vehicleId: vehicle.id });
          if (!controlLeaseId) {
            if (!leaseWarningRef.current) {
              leaseWarningRef.current = true;
              addTerminalLine('Control lease missing; re-select vehicle to start a control session.');
            }
          } else {
            if (activeMode === 'manual') {
              sendClientMessage({
                type: 'control',
                vehicleId: vehicle.id,
                payload: {
                  seq: controlSeqRef.current++,
                  leaseId: controlLeaseId,
                  buttons,
                  axes,
                  mode: 'manual',
                },
              });
            }
          }
          void enqueueTelemetry(payload, { userId: user?.id, vehicleId: vehicle.id });
          pendingTelemetryRef.current = JSON.stringify(payload);
        }

        if (!pausedRef.current && controlLeaseId && activeMode === 'auto') {
          const AUTO_HEARTBEAT_MS = 1000;
          if (modeRising || now - lastAutoControlSentRef.current >= AUTO_HEARTBEAT_MS) {
            lastAutoControlSentRef.current = now;
            sendClientMessage({
              type: 'control',
              vehicleId: vehicle.id,
              payload: {
                seq: controlSeqRef.current++,
                leaseId: controlLeaseId,
                buttons,
                axes,
                mode: 'auto',
              },
            });
          }
        }
      } else {
        if (now - lastGamepadUiUpdateRef.current >= GAMEPAD_UI_THROTTLE_MS) {
          lastGamepadUiUpdateRef.current = now;
          setGamepadState((prev) => (prev.connected ? { ...prev, connected: false } : prev));
        }
        lastPayloadRef.current = null;
      }
      animationFrameId.current = requestAnimationFrame(pollGamepad);
    };

    animationFrameId.current = requestAnimationFrame(pollGamepad);

    const handleGamepadConnected = (e: GamepadEvent) => {
      addTerminalLine(`Gamepad connected: ${e.gamepad.id}`);
      const buttons = e.gamepad.buttons.map((button) =>
        normalizeButton(typeof button.value === 'number' ? button.value : button.pressed ? 1 : 0)
      );
      const axes = Array.from(e.gamepad.axes, (axis) => normalizeAxis(axis));
      setGamepadState((prev) =>
        hasGamepadUiChanged(prev, buttons, axes, true) ? { buttons, axes, connected: true } : prev
      );
    };
    const handleGamepadDisconnected = () => {
      addTerminalLine('Gamepad disconnected');
      const anyConnected = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).some(
        (pad) => !!pad && pad.connected
      );
      if (!anyConnected) {
        setGamepadState((prev) => (prev.connected ? { ...prev, connected: false } : prev));
      }
    };
    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
    };
  }, [
    addTerminalLine,
    cancelMissionPrompt,
    confirmMission,
    controlLeaseId,
    cycleMissionSelection,
    estopLatched,
    refreshMissions,
    requestAutoMode,
    resolveSelectedMission,
    sendClientMessage,
    sendControlMode,
    user?.id,
    vehicle,
  ]);

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
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [terminalOutput]);

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

  const openMapWindow = () => {
    const params = new URLSearchParams();
    params.set('vehicleId', vehicleId);
    params.set('focus', 'map');
    if (sessionId) params.set('session', sessionId);
    const popup = window.open(
      `/control?${params.toString()}`,
      '_blank',
      'noopener,noreferrer'
    );
    registerSecondaryWindow(popup);
  };

  const openVideoWindow = () => {
    const params = new URLSearchParams();
    params.set('vehicleId', vehicleId);
    params.set('focus', 'video');
    if (sessionId) params.set('session', sessionId);
    const popup = window.open(
      `/control?${params.toString()}`,
      '_blank',
      'noopener,noreferrer'
    );
    registerSecondaryWindow(popup);
  };

  const openControlWindow = () => {
    const params = new URLSearchParams();
    params.set('vehicleId', vehicleId);
    params.set('focus', 'control');
    if (sessionId) params.set('session', sessionId);
    const popup = window.open(
      `/control?${params.toString()}`,
      '_blank',
      'noopener,noreferrer'
    );
    registerSecondaryWindow(popup);
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleOpenInsight = (view: 'user' | 'coop' | 'diagnostics') => {
    setInsightOverlay(view);
    setNavOpen(false);
  };

  const handleSendCoopMessage = (nextText?: string) => {
    const text = (nextText ?? coopMessageInput).trim();
    if (!text || !sessionId || !user?.id || !user.username) return;
    sendClientMessage({
      type: 'coop_chat',
      sessionId,
      vehicleId: isSpectatorSession ? undefined : vehicleId,
      userId: user.id,
      username: user.username,
      text,
    });
    if (!nextText) {
      setCoopMessageInput('');
    }
  };

  const handleStartCoopSession = () => {
    const nextSessionId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 12)
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const params = new URLSearchParams(location.search);
    params.set('session', nextSessionId);
    params.delete('spectator');
    navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: false });
  };

  const handleShareCurrentRoute = () => {
    if (!sessionId || !selectedMissionRoute || !user?.id || !user.username) return;
    sendClientMessage({
      type: 'coop_share_route',
      sessionId,
      vehicleId,
      userId: user.id,
      username: user.username,
      label: selectedMission?.name || `Route from ${vehicleId}`,
      route: selectedMissionRoute,
      distanceMeters: selectedMission?.distanceMeters,
      etaSeconds: selectedMission?.etaSeconds,
    });
  };

  const handleClearSharedRoute = () => {
    if (!sessionId) return;
    sendClientMessage({
      type: 'coop_clear_route',
      sessionId,
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
      navigate('/user');
      return;
    }

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

    clearLastVehicleSelection(user.id);
    navigate('/user');
  };

  if (isFocusMap) {
    return <FocusMapView />;
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
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border/70 bg-muted/20 px-10 py-2 text-sm">
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
        open={insightOverlay === 'coop'}
        title="Co-op"
        onClose={() => setInsightOverlay(null)}
        maxWidthClassName="max-w-5xl"
      >
        <div className="grid gap-5">
          <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(8,47,73,0.92)_45%,rgba(20,83,45,0.88))] p-5 text-white shadow-xl">
            <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.26),transparent_55%)]" />
            <div className="relative grid gap-5 lg:grid-cols-[1.45fr_0.95fr]">
              <div className="grid gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-2">
                    <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/80">
                      <Users className="size-3.5" />
                      Mission Room
                    </div>
                    <div>
                      <div className="text-2xl font-semibold">
                        {sessionId ? `Session ${sessionId.slice(0, 8)}` : 'Create a coordinated driving session'}
                      </div>
                      <div className="mt-1 max-w-2xl text-sm text-white/70">
                        Drivers, spectators, shared route context, and low-friction chat for synchronized vehicle ops.
                      </div>
                    </div>
                  </div>
                  {!sessionId ? (
                    <Button size="sm" className="bg-white text-slate-950 hover:bg-white/90" onClick={handleStartCoopSession}>
                      Start Room
                    </Button>
                  ) : (
                    <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-right">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-white/60">Host</div>
                      <div className="mt-1 text-sm font-medium">{coopState.hostUsername || 'Awaiting active driver'}</div>
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/60">Drivers</div>
                    <div className="mt-2 text-2xl font-semibold">{driverCount}</div>
                    <div className="mt-1 text-xs text-white/65">Controlling vehicles inside the room</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/60">Spectators</div>
                    <div className="mt-2 text-2xl font-semibold">{spectatorCount}</div>
                    <div className="mt-1 text-xs text-white/65">Read-only observers following the action</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-white/60">Shared Route</div>
                    <div className="mt-2 text-sm font-semibold">
                      {sharedSessionRoute ? coopState.sharedRoute?.label || 'Route live' : 'None shared'}
                    </div>
                    <div className="mt-1 text-xs text-white/65">
                      {sharedSessionRoute ? `Published by ${coopState.sharedRoute?.author}` : 'Publish a route for coordinated movement'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 rounded-3xl border border-white/10 bg-black/20 p-4 backdrop-blur">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-white/60">
                  <Link2 className="size-3.5" />
                  Room Access
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs text-white/55">Invite link</div>
                  <div className="mt-2 break-all font-mono text-[11px] text-white/90">
                    {inviteUrl || 'Create a room to generate a spectator link.'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/20 bg-white/10 text-white hover:bg-white/15"
                    onClick={() => void handleCopyInvite()}
                    disabled={!inviteUrl}
                  >
                    <Copy className="mr-2 size-4" />
                    {inviteCopied ? 'Copied' : 'Copy Link'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/20 bg-white/10 text-white hover:bg-white/15"
                    onClick={() => setCoopChatOpen((prev) => !prev)}
                    disabled={!sessionId}
                  >
                    <MessagesSquare className="mr-2 size-4" />
                    {coopChatOpen ? 'Hide Chat' : 'Open Chat'}
                  </Button>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/65">
                  Spectators inherit the same room context on focus-map windows without taking vehicle control.
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="grid gap-4">
              <div className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Roster</div>
                    <div className="text-xs text-muted-foreground">Who is driving, watching, and which vehicle they represent</div>
                  </div>
                  <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px]">
                    {coopParticipants.length} connected
                  </Badge>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {coopParticipants.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                      No one is in the room yet.
                    </div>
                  ) : (
                    coopParticipants.map((participant) => (
                      <div
                        key={participant.userId}
                        className={`rounded-2xl border p-4 ${
                          participant.isHost
                            ? 'border-sky-400/40 bg-sky-500/10'
                            : participant.role === 'spectator'
                              ? 'border-border/70 bg-muted/20'
                              : 'border-emerald-500/25 bg-emerald-500/10'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{participant.username}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {participant.vehicleId || 'No vehicle bound'}
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className={`rounded-full px-2.5 py-1 text-[11px] ${
                              participant.isHost
                                ? 'border-sky-400/40 text-sky-700 dark:text-sky-300'
                                : participant.role === 'spectator'
                                  ? ''
                                  : 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            {participant.isHost ? 'Host' : participant.role === 'spectator' ? 'Spectator' : 'Driver'}
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Shared Route</div>
                    <div className="text-xs text-muted-foreground">Publish the current route so the room can align on movement</div>
                  </div>
                  <Route className="size-4 text-muted-foreground" />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                    <div className="text-sm font-medium">
                      {sharedSessionRoute ? coopState.sharedRoute?.label || 'Coordinated route' : 'No shared route yet'}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {sharedSessionRoute
                        ? `Broadcast by ${coopState.sharedRoute?.author}`
                        : 'Use the mission route already loaded on this vehicle as the room route.'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-col">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleShareCurrentRoute}
                      disabled={!sessionId || !selectedMissionRoute}
                    >
                      Share Current Route
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleClearSharedRoute}
                      disabled={!sessionId || !sharedSessionRoute}
                    >
                      Clear Route
                    </Button>
                  </div>
                </div>
                <div className="mt-3 rounded-2xl border border-dashed border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
                  Race objectives and structured session goals can hang off this room model later without changing the chat or map surfaces again.
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Room Feed</div>
                    <div className="text-xs text-muted-foreground">Persistent chat mirrored in the floating dock across controller and secondary displays</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setCoopChatOpen((prev) => !prev)} disabled={!sessionId}>
                    {coopChatOpen ? 'Collapse' : 'Expand'}
                  </Button>
                </div>
                {coopChatOpen ? (
                  <div className="mt-4 grid gap-3">
                    <div className="max-h-72 overflow-y-auto rounded-2xl border border-border/70 bg-background/60 p-3 text-sm">
                      {coopMessages.length === 0 ? (
                        <div className="text-muted-foreground">No messages yet.</div>
                      ) : (
                        coopMessages.map((msg) => (
                          <div key={msg.id} className="mb-3 rounded-xl bg-muted/30 px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-semibold">{msg.author}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {new Date(msg.ts).toLocaleTimeString()}
                              </span>
                            </div>
                            <div className="mt-1 text-sm">{msg.text}</div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={coopMessageInput}
                        onChange={(event) => setCoopMessageInput(event.target.value)}
                        placeholder="Send a room-wide note"
                      />
                      <Button size="sm" onClick={() => handleSendCoopMessage()} disabled={!sessionId}>
                        Send
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                    Keep the dock collapsed until you need the full feed.
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Ops Notes</div>
                    <div className="text-xs text-muted-foreground">Current implementation boundaries</div>
                  </div>
                  <Mic className="size-4 text-muted-foreground" />
                </div>
                <div className="mt-4 grid gap-3 text-sm text-muted-foreground">
                  <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                    Peer vehicles visible on map: <span className="font-medium text-foreground">{coopVehicles.length}</span>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                    Voice remains intentionally unwired. Reuse the existing SFU path when live audio is implemented.
                  </div>
                </div>
              </div>
            </div>
          </section>
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
                aria-label="Open map in new page"
                title="Open map in new page"
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
      {(!modules.video || !modules.map || !modules.visualizer || !modules.stream) && (
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
              {!modules.map && (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => toggleModule('map')}
                  aria-label="Show mini map"
                  title="Show mini map"
                  className="rounded-full"
                >
                  <MapIcon className="size-4" />
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
                  aria-label="Show data stream"
                  title="Show data stream"
                  className="rounded-full"
                >
                  <Terminal className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </aside>
      )}
      <header className="relative z-[140] border-b border-border/80 bg-card/90 backdrop-blur">
            <div className="container mx-auto flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">IVY</h1>
                  <p className="hidden text-sm text-muted-foreground md:block">
                    {vehicle
                      ? `User: ${user?.username || 'Unknown'} | ${vehicle.model} (${vehicle.id}) | Lease: ${
                          controlLeaseId ? 'active' : 'missing'
                        }`
                      : `User: ${user?.username || 'Unknown'} | No vehicle selected`}
                  </p>
                </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ControllerQuickMenu
              open={navOpen}
              onToggle={() => setNavOpen((prev) => !prev)}
              onSelect={handleOpenInsight}
            />
            <Button onClick={toggleTheme} variant="outline" size="icon">
              {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </Button>
            <Button onClick={() => void handleEndSession()} variant="outline">End Session</Button>
            <Button onClick={handleLogout} variant="outline">
              <LogOut className="mr-2 size-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>

        <main className="container mx-auto px-4 py-6">
          <Tabs value={activeMainTab} onValueChange={(v) => setActiveMainTab(v as 'ops' | 'status' | 'stream')} className="space-y-6">

            {activeMainTab === 'ops' && (
            <TabsContent value="ops" className="space-y-4">
              <Card className="border-border/70 bg-card/90">
                <CardHeader className="p-0" />
                <CardContent className="space-y-2 pt-0">
                  <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
                    {modules.video && (
                      <div className="relative lg:col-span-2">
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => toggleModule('video')}
                          aria-label="Hide video panel"
                          title="Hide video panel"
                          className="absolute right-3 top-3 z-10 rounded-full bg-card/80 backdrop-blur"
                        >
                          <Minimize2 className="size-4" />
                        </Button>
                        <Suspense fallback={<OpsPanelFallback title="Video" />}>
                          <VideoPanel
                            signalingUrl={getDefaultSignalingUrl()}
                            roomId={roomId}
                            viewerId={viewerId}
                            className="flex h-full flex-col"
                            videoClassName="h-full min-h-[30rem] flex-1"
                          />
                        </Suspense>
                      </div>
                    )}

                    <div className="space-y-3 lg:col-span-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => setDeviceOverlayOpen(true)}
                          className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-2.5 py-1 transition hover:border-border hover:bg-card/90"
                          title="Device status"
                        >
                          <Car
                            className={`size-4 ${
                              deviceOnline
                                ? 'text-emerald-500 drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]'
                                : 'text-slate-400'
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => setControllerOverlayOpen(true)}
                          className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-2.5 py-1 transition hover:border-border hover:bg-card/90"
                          title="Controller status"
                        >
                          <Gamepad2
                            className={`size-4 ${
                              (gamepadState.connected || hidDevice)
                                ? 'text-emerald-500 drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]'
                                : 'text-slate-400'
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={handleAutoIndicatorClick}
                          className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-2.5 py-1 transition hover:border-border hover:bg-card/90"
                          title={driveMode === 'auto' ? 'Auto mode active' : 'Manual mode'}
                        >
                          <Bot
                            className={`size-4 ${
                              driveMode === 'auto'
                                ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.75)]'
                                : 'text-slate-400'
                            }`}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                      {modules.map && (
                        <Suspense fallback={<OpsPanelFallback title="Map" />}>
                          <MapPanel
                            location={locationFeed.latest}
                            peerLocations={coopVehicles
                              .filter((entry) => typeof entry.lat === 'number' && typeof entry.lng === 'number')
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
                            route={selectedMissionRoute}
                            sharedRoute={sharedSessionRoute}
                            waypoints={displayWaypoints}
                            showWaypoints
                            followHeading
                            followLocation={followVehicleMap}
                            syncKey={`vehicle:${vehicleId}`}
                            syncMode="read"
                            autoFitRouteSignal={routeFocusSignal}
                            mapOverlay={
                              <>
                                <div className="absolute right-3 top-3 pointer-events-auto">
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    onClick={() => toggleModule('map')}
                                    aria-label="Hide mini map"
                                    title="Hide mini map"
                                    className="rounded-full bg-card/80 backdrop-blur"
                                  >
                                    <Minimize2 className="size-4" />
                                  </Button>
                                </div>
                                {!selectedMissionRoute &&
                                  selectedMission?.waypoints &&
                                  selectedMission.waypoints.length >= 2 && (
                                    <div className="absolute right-12 top-3 rounded-full border border-border/70 bg-card/90 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm">
                                      Route loading...
                                    </div>
                                  )}
                                <div className="absolute left-4 bottom-4 pointer-events-auto">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="bg-card/90 backdrop-blur"
                                    onClick={() => setFollowVehicleMap(true)}
                                    title="Follow vehicle"
                                  >
                                    <GoogleMapsLocationIcon className="size-4" />
                                  </Button>
                                </div>
                              </>
                            }
                          />
                        </Suspense>
                      )}

                    {modules.stream && (
                      <DataStreamPanel
                        terminalOutput={terminalOutput}
                        terminalRef={terminalRef}
                        onHide={() => toggleModule('stream')}
                      />
                    )}
                  </div>
                </div>

                {modules.visualizer && (
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
                    <div className="flex items-center gap-2">
                      {gamepadState.connected ? (
                        <>
                          <Wifi className="size-5 text-green-500" />
                          <span className="text-sm font-medium">Controller connected</span>
                        </>
                      ) : (
                        <>
                          <WifiOff className="size-5 text-red-500" />
                          <span className="text-sm font-medium">Controller disconnected</span>
                        </>
                      )}
                      <span title={driveMode === 'auto' ? 'Auto mode active' : 'Manual mode'}>
                        <Bot
                          className={`ml-2 size-5 ${
                            driveMode === 'auto'
                              ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.75)]'
                              : 'text-slate-400'
                          }`}
                          aria-hidden="true"
                        />
                      </span>
                    </div>
                    <div className="rounded-lg border border-border p-3 text-sm">
                      <div className="text-muted-foreground">Server input reception</div>
                      <div className="font-medium">
                        {serverTelemetryAck.lastAckTs
                          ? `Receiving (${serverTelemetryAck.received} samples acknowledged)`
                          : 'Waiting for input acknowledgment'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Last ack:{' '}
                        {serverTelemetryAck.lastAckTs
                          ? new Date(serverTelemetryAck.lastAckTs).toLocaleTimeString()
                          : '-'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="default" className={(inputPaused || estopLatched) ? 'bg-yellow-500' : 'bg-green-600'}>
                        {(pauseLatched || estopLatched) ? 'Paused' : 'Active'}
                      </Badge>
                      <Badge variant="default" className={driveMode === 'auto' ? 'bg-blue-600' : 'bg-slate-500/60'}>
                        {driveMode === 'auto' ? 'Auto Mode' : 'Manual Mode'}
                      </Badge>
                      <Badge variant="default" className={estopLatched ? 'bg-red-600' : 'bg-slate-500/60'}>
                        {estopLatched ? 'E-Stop' : 'E-Stop Clear'}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {estopLatched
                          ? 'Emergency stop latched'
                          : pauseLatched
                            ? 'Input paused'
                            : 'Ready to control vehicle'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => setPauseLatched((prev) => !prev)}
                        variant={(pauseLatched || estopLatched) ? 'default' : 'outline'}
                        disabled={estopLatched}
                      >
                        {(pauseLatched || estopLatched) ? 'Resume Input' : 'Pause Input'}
                      </Button>
                      <Button
                        onClick={() => setEstopLatched(false)}
                        variant="destructive"
                        disabled={!estopLatched}
                      >
                        Clear E-Stop
                      </Button>
                      <Button onClick={triggerHaptics} variant="outline" disabled={hapticsSupported === false}>
                        Test Haptics
                      </Button>
                    </div>
                    <div className="space-y-3 rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">Autonomy</div>
                          <div className="text-xs text-muted-foreground">
                            Mode: {driveMode.toUpperCase()}
                            {activeMissionId
                              ? ` â€¢ Active mission: ${formatMissionSummary(
                                  (draftMission && activeMissionId === draftMission.id
                                    ? draftMission
                                    : missions.find((m) => m.id === activeMissionId)) || null,
                                  mapRegionLabel
                                )}`
                              : ''}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant={driveMode === 'auto' ? 'default' : 'outline'}
                            onClick={() => (driveMode === 'auto' ? cancelMissionPrompt() : requestAutoMode())}
                          >
                            {driveMode === 'auto' ? 'Exit Auto' : 'Enable Auto'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={refreshMissions}>
                            Refresh
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <label className="text-xs uppercase text-muted-foreground">Mission</label>
                        <Select
                          value={selectedMissionId}
                          onValueChange={(value) => setSelectedMissionId(value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select mission" />
                          </SelectTrigger>
                          <SelectContent>
                            {missions
                              .filter((entry) => entry.vehicleId === vehicle?.id)
                              .map((entry) => (
                                <SelectItem key={entry.id} value={entry.id}>
                                  {entry.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <div className="text-xs text-muted-foreground">
                          {formatMissionSummary(resolveSelectedMission(), mapRegionLabel)}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={stopVehicleNow}>
                            Stop Vehicle
                          </Button>
                          <Button size="sm" variant="outline" onClick={sendRetraceMission}>
                            Retrace Steps
                          </Button>
                          <Button size="sm" variant="outline" onClick={requestAutoMode}>
                            Send New Mission
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">Controller battery: {batteryLevel !== null ? `${batteryLevel}%` : 'Unavailable'}</div>
                    <div className="space-y-2 rounded-lg border border-border p-3">
                      <div className="text-sm font-medium">Controller Lightbar (WebHID)</div>
                      {!hidSupported && <div className="text-xs text-muted-foreground">WebHID is not supported in this browser.</div>}
                      {hidSupported && !hidSecure && <div className="text-xs text-muted-foreground">WebHID requires HTTPS or localhost.</div>}
                      {canUseHid && (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button onClick={hidDevice ? handleDisconnectHid : handleConnectHid} variant="outline">
                              {hidDevice ? 'Disconnect' : 'Connect'}
                            </Button>
                            <input
                              type="color"
                              value={lightbarColor}
                              onChange={(event) => setLightbarColor(event.target.value)}
                              className="h-8 w-10 rounded border border-border bg-transparent p-0"
                              aria-label="Lightbar color"
                            />
                            <Button
                              onClick={() => hidDevice && sendLightbarColor(hidDevice, lightbarColor, hidProfile || 'unknown')}
                              variant="outline"
                              disabled={!hidDevice}
                            >
                              Apply
                            </Button>
                          </div>
                          <div className="text-xs text-muted-foreground">USB connection required. Detected profile: {hidProfile || 'none'}</div>
                        </>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="websocket" className="space-y-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">WebSocket URL</label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          value={wsUrlInput}
                          onChange={(event) => setWsUrlInput(event.target.value)}
                          placeholder="wss://random.trycloudflare.com"
                          className="sm:flex-1"
                          aria-label="WebSocket URL"
                        />
                        <div className="flex gap-2">
                          <Button onClick={handleWsSave}>Apply</Button>
                          <Button onClick={handleWsClear} variant="outline">Reset</Button>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">Active URL: {wsUrl}</div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>
          )}

          {activeMainTab === 'stream' && (
          <TabsContent value="stream">
            <Card className="border-border/70 bg-card/90">
              <CardHeader>
                <CardTitle className="font-mono text-base">Data Stream</CardTitle>
              </CardHeader>
              <CardContent>
                <div ref={terminalRef} className="h-[240px] overflow-y-auto rounded-lg bg-black p-3 font-mono text-xs text-green-400">
                  {terminalOutput.length === 0 ? (
                    <div className="text-muted-foreground">Waiting for events...</div>
                  ) : (
                    terminalOutput.map((line, index) => <div key={index} className="mb-1">{line}</div>)
                  )}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Format: [x, o, box, triangle, l1, r1, l2(0-1), r2(0-1), share, play, l3, r3, up, down, left, right, ps, touch, leftX, leftY, rightX, rightY]
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          )}
        </Tabs>
        {sessionId && (
          <div className="pointer-events-none fixed bottom-4 right-4 z-40">
            <CoopChatDock
              coopState={coopState}
              onSendChat={handleSendCoopMessage}
              onClearRoute={isCoopHost ? handleClearSharedRoute : undefined}
            />
          </div>
        )}
      </main>
    </div>
  );
}




