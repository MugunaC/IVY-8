import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '@/app/context/AuthContext';
import { useVehicleLocationFeed } from '@/app/hooks/useVehicleLocationFeed';
import { usePresence } from '@/app/hooks/usePresence';
import { useCoopSession } from '@/app/hooks/useCoopSession';
import { useControlSocket } from '@/app/hooks/realtime/useControlSocket';
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
import { getVehicles, markVehicleInUse } from '@/app/data/vehiclesRepo';
import { clientMessageSchema } from '@shared/protocol';
import type { MissionPathType, MissionPlan, MissionWaypoint, TelemetryPayload, Vehicle, WsServerMessage } from '@shared/types';
import {
  Bot,
  Car,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Compass,
  ChevronDown,
  Flag,
  Layers,
  Plus,
  RotateCcw,
  Search,
  Sun,
  Trash2,
  SlidersHorizontal,
  Minimize2,
  Maximize2,
  Shuffle,
  Wifi,
  Gamepad2,
  X,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { OverlayModal } from '@/app/components/ui/overlay-modal';
import { CoopChatDock } from '@/app/components/realtime/CoopChatDock';
import { GoogleMapsLocationIcon } from '@/app/components/realtime/GoogleMapsLocationIcon';
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

type IndicatorProps = {
  deviceOnline: boolean;
  gamepadConnected: boolean;
  driveMode: 'manual' | 'auto';
  onDeviceClick: () => void;
  onControllerClick: () => void;
  onAutoClick: () => void;
};

function IndicatorButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-2.5 py-1 transition hover:border-border hover:bg-card/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      {children}
    </button>
  );
}

function IndicatorsRow(props: IndicatorProps) {
  const { deviceOnline, gamepadConnected, driveMode, onDeviceClick, onControllerClick, onAutoClick } = props;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <IndicatorButton title="Device status" onClick={onDeviceClick}>
        <Car
          className={`size-4 ${
            deviceOnline ? 'text-emerald-500 drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'text-slate-400'
          }`}
        />
      </IndicatorButton>
      <IndicatorButton title="Controller status" onClick={onControllerClick}>
        <Gamepad2
          className={`size-4 ${
            gamepadConnected
              ? 'text-emerald-500 drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]'
              : 'text-slate-400'
          }`}
        />
      </IndicatorButton>
      <IndicatorButton title={driveMode === 'auto' ? 'Auto mode active' : 'Manual mode'} onClick={onAutoClick}>
        <Bot
          className={`size-4 ${
            driveMode === 'auto'
              ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.75)]'
              : 'text-slate-400'
          }`}
          aria-hidden="true"
        />
      </IndicatorButton>
    </div>
  );
}

const VISUALIZER_MIN_HEIGHT = 380;
const MAP_THEMES: Array<{ key: string; label: string; style: maplibregl.StyleSpecification }> = [
  {
    key: 'topo',
    label: 'Topo',
    style: {
      version: 8,
      sources: {
        topo: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 20,
          attribution: 'Tiles (c) Esri',
        },
      },
      layers: [{ id: 'topo-base', type: 'raster', source: 'topo' }],
    },
  },
  {
    key: 'streets',
    label: 'Streets',
    style: {
      version: 8,
      sources: {
        streets: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 20,
          attribution: 'Tiles (c) Esri',
        },
      },
      layers: [{ id: 'streets-base', type: 'raster', source: 'streets' }],
    },
  },
  {
    key: 'imagery',
    label: 'Imagery',
    style: {
      version: 8,
      sources: {
        imagery: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 20,
          attribution: 'Tiles (c) Esri',
        },
      },
      layers: [{ id: 'imagery-base', type: 'raster', source: 'imagery' }],
    },
  },
  {
    key: 'gray',
    label: 'Gray',
    style: {
      version: 8,
      sources: {
        gray: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 20,
          attribution: 'Tiles (c) Esri',
        },
      },
      layers: [{ id: 'gray-base', type: 'raster', source: 'gray' }],
    },
  },
  {
    key: 'dark-gray',
    label: 'Dark Gray',
    style: {
      version: 8,
      sources: {
        darkGray: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 20,
          attribution: 'Tiles (c) Esri',
        },
      },
      layers: [{ id: 'dark-gray-base', type: 'raster', source: 'darkGray' }],
    },
  },
  {
    key: 'terrain',
    label: 'Terrain',
    style: {
      version: 8,
      sources: {
        terrain: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 13,
          attribution: 'Tiles (c) Esri',
        },
      },
      layers: [{ id: 'terrain-base', type: 'raster', source: 'terrain' }],
    },
  },
  {
    key: 'ocean',
    label: 'Ocean',
    style: {
      version: 8,
      sources: {
        ocean: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 20,
          attribution: 'Tiles (c) Esri',
        },
      },
      layers: [{ id: 'ocean-base', type: 'raster', source: 'ocean' }],
    },
  },
];

const round = (value: number, decimals: number) => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

const OSRM_URL = import.meta.env.VITE_OSRM_URL || import.meta.env.VITE_ROUTING_URL;
const WEATHER_URL = import.meta.env.VITE_WEATHER_URL;

type OsrmManeuver = {
  type?: string;
  modifier?: string;
  exit?: number;
};

type OsrmStep = {
  name?: string;
  distance?: number;
  duration?: number;
  maneuver?: OsrmManeuver;
};

type RouteAlternative = {
  coordinates: [number, number][];
  distance: number;
  duration: number;
  steps: OsrmStep[];
};

type InstructionLocale = 'en' | 'sw';

const resolveInstructionLocale = (): InstructionLocale => {
  const lang =
    typeof navigator !== 'undefined' && navigator.language ? navigator.language.toLowerCase() : 'en';
  if (lang.startsWith('sw')) return 'sw';
  return 'en';
};

const toRad = (value: number) => (value * Math.PI) / 180;
const haversineDistance = (a: MissionWaypoint, b: MissionWaypoint) => {
  const r = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
};

const computeRouteDistance = (coords: [number, number][]) => {
  if (coords.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const a: MissionWaypoint = { lng: coords[i - 1][0], lat: coords[i - 1][1] };
    const b: MissionWaypoint = { lng: coords[i][0], lat: coords[i][1] };
    sum += haversineDistance(a, b);
  }
  return sum;
};

const formatMeters = (value: number) => {
  if (!Number.isFinite(value)) return '--';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
  return `${Math.round(value)} m`;
};

const formatEta = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '--';
  const totalSeconds = Math.round(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  return `${minutes}m ${seconds}s`;
};

const headingToCompass = (heading: number | undefined) => {
  if (typeof heading !== 'number' || Number.isNaN(heading)) return '--';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((heading % 360) + 360) / 45) % 8;
  return directions[index];
};

const formatCoordValue = (value: number | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return value.toFixed(6);
};

const formatStepInstruction = (step: OsrmStep, locale: InstructionLocale) => {
  const maneuver = step.maneuver;
  const name = step.name ? step.name.trim() : '';
  const rawType = maneuver?.type ? maneuver.type.replace(/_/g, ' ').toLowerCase().trim() : '';
  const rawModifier = maneuver?.modifier ? maneuver.modifier.replace(/_/g, ' ').toLowerCase().trim() : '';

  const t =
    locale === 'sw'
      ? {
          depart: 'Anza',
          departOn: (road: string) => (road ? `Anza kwenye ${road}` : 'Anza'),
          arrive: 'Fika kwenye kituo',
          roundabout: (exit?: number) =>
            exit ? `Ingiza kwenye mzunguko na chukua kutoka ${exit}` : 'Ingiza kwenye mzunguko',
          exitRoundabout: 'Toka kwenye mzunguko',
          continue: 'Endelea',
          continueOn: (road: string) => (road ? `Endelea kwenye ${road}` : 'Endelea'),
          turn: (dir: string) => (dir ? `Geuka ${dir}` : 'Geuka'),
          turnOnto: (dir: string, road: string) =>
            road ? `Geuka ${dir} kwenye ${road}` : `Geuka ${dir}`,
          keep: (dir: string) => (dir ? `Kaa ${dir}` : 'Kaa kulia'),
          merge: (road: string) => (road ? `Ungana na ${road}` : 'Ungana'),
          onRamp: (road: string) => (road ? `Panda njia ya kuingia ${road}` : 'Panda njia ya kuingia'),
          offRamp: (road: string) => (road ? `Shuka kwenye njia ya kutoka ${road}` : 'Shuka kwenye njia ya kutoka'),
          endOfRoad: (dir: string) => (dir ? `Geuka ${dir} mwisho wa barabara` : 'Geuka mwisho wa barabara'),
          uturn: 'Geuka U',
          straight: 'moja kwa moja',
          left: 'kushoto',
          right: 'kulia',
          slightLeft: 'kidogo kushoto',
          slightRight: 'kidogo kulia',
          sharpLeft: 'kali kushoto',
          sharpRight: 'kali kulia',
        }
      : {
          depart: 'Depart',
          departOn: (road: string) => (road ? `Depart onto ${road}` : 'Depart'),
          arrive: 'Arrive at destination',
          roundabout: (exit?: number) =>
            exit ? `Enter roundabout and take exit ${exit}` : 'Enter roundabout',
          exitRoundabout: 'Exit roundabout',
          continue: 'Continue',
          continueOn: (road: string) => (road ? `Continue on ${road}` : 'Continue'),
          turn: (dir: string) => (dir ? `Turn ${dir}` : 'Turn'),
          turnOnto: (dir: string, road: string) =>
            road ? `Turn ${dir} onto ${road}` : `Turn ${dir}`,
          keep: (dir: string) => (dir ? `Keep ${dir}` : 'Keep right'),
          merge: (road: string) => (road ? `Merge onto ${road}` : 'Merge'),
          onRamp: (road: string) => (road ? `Take the ramp onto ${road}` : 'Take the ramp'),
          offRamp: (road: string) => (road ? `Take the exit toward ${road}` : 'Take the exit'),
          endOfRoad: (dir: string) => (dir ? `Turn ${dir} at end of road` : 'Turn at end of road'),
          uturn: 'Make a U-turn',
          straight: 'straight',
          left: 'left',
          right: 'right',
          slightLeft: 'slight left',
          slightRight: 'slight right',
          sharpLeft: 'sharp left',
          sharpRight: 'sharp right',
        };

  const modifierLabel = (() => {
    switch (rawModifier) {
      case 'uturn':
      case 'u-turn':
        return t.uturn;
      case 'straight':
        return t.straight;
      case 'left':
        return t.left;
      case 'right':
        return t.right;
      case 'slight left':
        return t.slightLeft;
      case 'slight right':
        return t.slightRight;
      case 'sharp left':
        return t.sharpLeft;
      case 'sharp right':
        return t.sharpRight;
      default:
        return rawModifier || '';
    }
  })();

  switch (rawType) {
    case 'depart':
      return name ? t.departOn(name) : t.depart;
    case 'arrive':
      return t.arrive;
    case 'roundabout':
    case 'rotary':
      return t.roundabout(maneuver?.exit);
    case 'exit roundabout':
    case 'exit rotary':
      return t.exitRoundabout;
    case 'new name':
      return t.continueOn(name);
    case 'merge':
      return t.merge(name);
    case 'on ramp':
      return t.onRamp(name);
    case 'off ramp':
      return t.offRamp(name);
    case 'fork':
      return t.keep(modifierLabel);
    case 'end of road':
      return t.endOfRoad(modifierLabel);
    case 'continue':
      return t.continueOn(name || modifierLabel);
    case 'roundabout turn':
      return modifierLabel ? t.turn(modifierLabel) : t.turn('');
    case 'turn':
    default:
      if (modifierLabel && name) return t.turnOnto(modifierLabel, name);
      if (modifierLabel) return t.turn(modifierLabel);
      if (name) return t.continueOn(name);
      return t.continue;
  }
};

const formatWaypointPreview = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

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
  const [syncedGamepadConnected, setSyncedGamepadConnected] = useState(false);
  const [telemetryCount, setTelemetryCount] = useState(0);
  const [syncedInputWsConnected, setSyncedInputWsConnected] = useState(false);
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
  const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternative[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeSteps, setRouteSteps] = useState<OsrmStep[]>([]);
  const [hoveredRouteIndex, setHoveredRouteIndex] = useState<number | null>(null);
  const [missionDistance, setMissionDistance] = useState(0);
  const [missionEta, setMissionEta] = useState(0);
  const [missions, setMissions] = useState<MissionPlan[]>([]);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [missionName, setMissionName] = useState('New Mission');
  const [draftMission, setDraftMission] = useState<MissionPlan | null>(null);
  const [pendingMission, setPendingMission] = useState<MissionPlan | null>(null);
  const [missionPrompt, setMissionPrompt] = useState<'none' | 'select' | 'confirm'>('none');
  const [missionActionFocus, setMissionActionFocus] = useState<'confirm' | 'cancel'>('confirm');
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const [routingStatus, setRoutingStatus] = useState<string | null>(null);
  const [missionSaveStatus, setMissionSaveStatus] = useState<string | null>(null);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [weatherSummary, setWeatherSummary] = useState<string>('');
  const [weatherUnavailableReason, setWeatherUnavailableReason] = useState<string>('');
  const [weatherCode, setWeatherCode] = useState<number | null>(null);
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
  const [vehicleInfo, setVehicleInfo] = useState<Vehicle | null>(null);
  const [driveMode, setDriveMode] = useState<'manual' | 'auto'>(
    presence.driveMode || 'manual'
  );
  const [controlLeaseId, setControlLeaseId] = useState<string | null>(
    presence.controlLeaseId ?? null
  );
  const lastPayloadRef = useRef<TelemetryPayload | null>(null);
  const telemetryCountRef = useRef(0);
  const visualizerRef = useRef<HTMLIFrameElement | null>(null);
  const visualizerContainerRef = useRef<HTMLDivElement | null>(null);
  const maxVisualizerHeightRef = useRef(0);
  const lastWeatherFetchRef = useRef(0);
  const selectedRouteIndexRef = useRef(0);
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
  const driveModeRef = useRef<'manual' | 'auto'>(driveMode);
  const prevModeButtonRef = useRef(false);
  const prevConfirmButtonRef = useRef(false);
  const prevCancelButtonRef = useRef(false);
  const prevMissionAxisRef = useRef(0);
  const lastMissionAxisSwitchRef = useRef(0);
  const missionPromptRef = useRef<'none' | 'select' | 'confirm'>('none');
  const pendingMissionRef = useRef<MissionPlan | null>(null);
  const missionsRef = useRef<MissionPlan[]>([]);
  const selectedMissionIdRef = useRef<string | null>(null);
  const activeMissionIdRef = useRef<string | null>(null);
  const draftMissionRef = useRef<MissionPlan | null>(null);
  const controlSeqRef = useRef(0);
  const lastAutoControlSentRef = useRef(0);
  const controlLeaseIdRef = useRef<string | null>(null);

  const debouncedWaypoints = useDebouncedValue(missionWaypoints, 250);
  const debouncedPathType = useDebouncedValue(missionPathType, 250);
  const debouncedProfile = useDebouncedValue(missionProfile, 250);
  const debouncedSpeed = useDebouncedValue(missionSpeedMps, 250);
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

  useEffect(() => {
    selectedRouteIndexRef.current = selectedRouteIndex;
  }, [selectedRouteIndex]);

  useEffect(() => {
    driveModeRef.current = driveMode;
    updatePresence({ driveMode });
  }, [driveMode, updatePresence]);

  const triggerRouteFocus = useCallback(() => {
    if (isFocusMap) {
      setFollowVehicleMap(false);
    }
    setRouteFocusSignal((prev) => prev + 1);
  }, [isFocusMap]);

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
    if (isPresenceOwner) return;
    if (presence.driveMode && presence.driveMode !== driveMode) {
      setDriveMode(presence.driveMode);
    }
  }, [presence.driveMode, driveMode, isPresenceOwner]);

  useEffect(() => {
    controlLeaseIdRef.current = controlLeaseId;
  }, [controlLeaseId]);

  useEffect(() => {
    updatePresence({ controlLeaseId });
  }, [controlLeaseId, updatePresence]);

  useEffect(() => {
    if (isPresenceOwner) return;
    if (presence.controlLeaseId !== undefined && presence.controlLeaseId !== controlLeaseId) {
      setControlLeaseId(presence.controlLeaseId ?? null);
    }
  }, [presence.controlLeaseId, controlLeaseId, isPresenceOwner]);

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
    if (!isFocusedDisplay) {
      updatePresence({ gamepadConnected: isGamepadConnected });
      setSyncedGamepadConnected(isGamepadConnected);
    }
  }, [isGamepadConnected, isFocusedDisplay, updatePresence]);

  useEffect(() => {
    if (isPresenceOwner) return;
    if (presence.gamepadConnected !== undefined) {
      setSyncedGamepadConnected(presence.gamepadConnected);
    }
  }, [presence.gamepadConnected, isPresenceOwner]);

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
  }, [isGamepadConnected]);

  useEffect(() => {
    if (!isFocusedDisplay) {
      updatePresence({ controlWsConnected: isTelemetryWsConnected });
      setSyncedInputWsConnected(isTelemetryWsConnected);
    }
  }, [isTelemetryWsConnected, isFocusedDisplay, updatePresence]);

  useEffect(() => {
    if (isPresenceOwner) return;
    if (presence.controlWsConnected !== undefined) {
      setSyncedInputWsConnected(presence.controlWsConnected);
    }
  }, [presence.controlWsConnected, isPresenceOwner]);

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
    missionPromptRef.current = missionPrompt;
  }, [missionPrompt]);

  useEffect(() => {
    if (!perfEnabled) return;
    const elapsed = performance.now() - renderStart;
    console.info(`[Perf][render][FocusMapView] ${elapsed.toFixed(1)}ms`);
  });

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

  useEffect(() => {
    if (!vehicleId || !user || isSpectatorSession) return;
    let cancelled = false;
    const hydrateLease = async () => {
      try {
        const vehicles = await getVehicles();
        const match = vehicles.find((item) => item.id === vehicleId);
        if (cancelled) return;
        setVehicleInfo(match ?? null);
        setControlLeaseId(match?.controlLeaseId ?? null);
        if (!match?.controlLeaseId) {
          const updated = await markVehicleInUse(vehicleId, user.username, user.id);
          if (cancelled) return;
          const next = updated.find((item) => item.id === vehicleId);
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
  }, [isSpectatorSession, vehicleId, user]);

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

  const handleManualAdd = () => {
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
  };

  useEffect(() => {
    const coords = debouncedWaypoints.map((point) => [point.lng, point.lat] as [number, number]);
    if (coords.length < 2) {
      setMissionRoute(null);
      setMissionDistance(0);
      setMissionEta(0);
      setRoutingStatus(null);
      return;
    }
    const effectivePathType = debouncedProfile === 'drone' ? 'straight' : debouncedPathType;
    if (debouncedProfile === 'drone' && debouncedPathType === 'roads') {
      setRoutingStatus('Drone profile uses straight-line routing.');
    }
    if (effectivePathType === 'straight' || !OSRM_URL) {
      if (effectivePathType === 'roads' && !OSRM_URL) {
        setRoutingStatus('OSRM URL not configured, using straight-line path.');
      } else if (effectivePathType !== 'straight') {
        setRoutingStatus(null);
      } else if (debouncedProfile !== 'drone') {
        setRoutingStatus(null);
      }
      const distance = computeRouteDistance(coords);
      setMissionRoute({ type: 'LineString', coordinates: coords });
      setRouteAlternatives([]);
      setSelectedRouteIndex(0);
      setRouteSteps([]);
      setHoveredRouteIndex(null);
      setMissionDistance(distance);
      setMissionEta(debouncedSpeed > 0 ? distance / debouncedSpeed : 0);
      return;
    }

    let cancelled = false;
    const buildRoutingUrl = (points: [number, number][]) => {
      if (!OSRM_URL) return null;
      const joined = points.map((item) => `${item[0]},${item[1]}`).join(';');
      const base = OSRM_URL.replace(/\/+$/, '');
      const prefix = base.includes('route/v1') ? base : `${base}/route/v1/driving`;
      return `${prefix}/${joined}?overview=full&geometries=geojson&steps=true&alternatives=true`;
    };

    const fetchRoute = async () => {
      const url = buildRoutingUrl(coords);
      if (!url) {
        return;
      }
      setRoutingStatus('Fetching road route...');
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Routing failed (${response.status})`);
        }
        const data = (await response.json()) as {
          routes?: Array<{
            geometry?: { coordinates?: [number, number][] };
            distance?: number;
            duration?: number;
            legs?: Array<{ steps?: OsrmStep[] }>;
          }>;
        };
        if (cancelled) return;
        const routes =
          data.routes?.map((route) => {
            const routeCoords = route.geometry?.coordinates || coords;
            const distance = route.distance ?? computeRouteDistance(routeCoords);
            const duration =
              route.duration ?? (debouncedSpeed > 0 ? distance / debouncedSpeed : 0);
            const steps =
              route.legs?.flatMap((leg) => leg.steps || []) ?? [];
            return { coordinates: routeCoords, distance, duration, steps };
          }) ?? [];

        if (!routes.length) {
          const distance = computeRouteDistance(coords);
          setMissionRoute({ type: 'LineString', coordinates: coords });
          setRouteAlternatives([]);
          setSelectedRouteIndex(0);
          setRouteSteps([]);
          setHoveredRouteIndex(null);
          setMissionDistance(distance);
          setMissionEta(debouncedSpeed > 0 ? distance / debouncedSpeed : 0);
          setRoutingStatus('Routing response returned no routes. Using straight-line path.');
          return;
        }

        const nextIndex = Math.min(selectedRouteIndexRef.current, routes.length - 1);
        const selected = routes[nextIndex];
        setRouteAlternatives(routes);
        setSelectedRouteIndex(nextIndex);
        setMissionRoute({ type: 'LineString' as const, coordinates: selected.coordinates });
        setRouteSteps(selected.steps);
        setHoveredRouteIndex(null);
        setMissionDistance(selected.distance);
        setMissionEta(selected.duration);
        setRoutingStatus(null);
      } catch (error) {
        if (cancelled) return;
        const distance = computeRouteDistance(coords);
        setMissionRoute({ type: 'LineString', coordinates: coords });
        setRouteAlternatives([]);
        setSelectedRouteIndex(0);
        setRouteSteps([]);
        setHoveredRouteIndex(null);
        setMissionDistance(distance);
        setMissionEta(debouncedSpeed > 0 ? distance / debouncedSpeed : 0);
        setRoutingStatus(
          error instanceof Error ? `${error.message}. Using straight-line path.` : 'Routing failed. Using straight-line path.'
        );
      }
    };

    void fetchRoute();

    return () => {
      cancelled = true;
    };
  }, [debouncedPathType, debouncedProfile, debouncedSpeed, debouncedWaypoints]);

  useEffect(() => {
    if (!WEATHER_URL) {
      setWeatherSummary('');
      setWeatherUnavailableReason('Weather API not configured');
      setWeatherCode(null);
      return;
    }
    const latest = locationFeed.latest;
    if (!latest) {
      setWeatherSummary('');
      setWeatherUnavailableReason('Waiting for GPS fix');
      setWeatherCode(null);
      return;
    }
    const now = Date.now();
    if (now - lastWeatherFetchRef.current < 60_000) {
      return;
    }
    lastWeatherFetchRef.current = now;
    setWeatherUnavailableReason('');
    const lat = latest.lat;
    const lng = latest.lng;
    const buildWeatherUrl = () => {
      if (WEATHER_URL.includes('{lat}') || WEATHER_URL.includes('{lng}')) {
        return WEATHER_URL.replace('{lat}', String(lat)).replace('{lng}', String(lng));
      }
      const separator = WEATHER_URL.includes('?') ? '&' : '?';
      return `${WEATHER_URL}${separator}lat=${lat}&lng=${lng}`;
    };
    const controller = new AbortController();
    const fetchWeather = async () => {
      try {
        const response = await fetch(buildWeatherUrl(), { signal: controller.signal });
        if (!response.ok) {
          setWeatherSummary('');
          setWeatherUnavailableReason('Weather service error');
          return;
        }
        const data = (await response.json()) as {
          current_weather?: { temperature?: number; windspeed?: number; weathercode?: number };
          temperature?: number;
          wind_speed?: number;
          summary?: string;
        };
        const temp = data.current_weather?.temperature ?? data.temperature ?? undefined;
        const wind = data.current_weather?.windspeed ?? data.wind_speed ?? undefined;
        const code =
          typeof data.current_weather?.weathercode === 'number' ? data.current_weather.weathercode : null;
        const summary =
          data.summary ||
          (temp !== undefined ? `${temp}°C` : '') +
            (wind !== undefined ? ` • wind ${wind} m/s` : '');
        if (summary) {
          setWeatherSummary(summary);
          setWeatherUnavailableReason('');
          setWeatherCode(code);
        } else {
          setWeatherSummary('');
          setWeatherUnavailableReason('Weather data missing');
          setWeatherCode(code);
        }
      } catch {
        if (!controller.signal.aborted) {
          setWeatherSummary('');
          setWeatherUnavailableReason('Weather request failed');
          setWeatherCode(null);
        }
      }
    };
    void fetchWeather();
    return () => controller.abort();
  }, [locationFeed.latest]);

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
  const weatherStatusLabel =
    weatherSummary ||
    (weatherUnavailableReason ? `Unavailable: ${weatherUnavailableReason}` : 'Unavailable');
  const lastSeenLabel = deviceStatus.lastSeenMs
    ? new Date(deviceStatus.lastSeenMs).toLocaleString()
    : 'n/a';
  const shouldShowMissionOverlay = missionPrompt !== 'none';
  const displayGamepadConnected = isFocusedDisplay ? syncedGamepadConnected : isGamepadConnected;
  const displayInputWsConnected = isFocusedDisplay ? syncedInputWsConnected : isTelemetryWsConnected;
  const displayTelemetryCount = isFocusedDisplay ? syncedTelemetryCount : telemetryCount;
  useEffect(() => {
    if (missionPrompt === 'confirm') {
      setMissionActionFocus('confirm');
    }
  }, [missionPrompt]);
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
    if (missionPrompt === 'none') return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepMissionChoice(-1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepMissionChoice(1);
        return;
      }
      if (event.key === 'Tab' && missionPrompt === 'confirm') {
        event.preventDefault();
        setMissionActionFocus((prev) => (prev === 'confirm' ? 'cancel' : 'confirm'));
        return;
      }
      if (event.key === 'Enter') {
        if (missionPrompt === 'confirm' && pendingMission) {
          if (missionActionFocus === 'confirm') {
            confirmMission(pendingMission);
          } else {
            cancelMissionPrompt();
          }
          return;
        }
        if (missionPrompt === 'select') {
          const selected =
            (draftMission && selectedMissionId === draftMission.id ? draftMission : null) ||
            resolveSelectedMission();
          if (selected) {
            setPendingMission(selected);
            setMissionPrompt('confirm');
            setMissionActionFocus('confirm');
          }
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    missionPrompt,
    pendingMission,
    missionActionFocus,
    draftMission,
    selectedMissionId,
    resolveSelectedMission,
    cancelMissionPrompt,
    confirmMission,
    stepMissionChoice,
  ]);

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
  });

  const weatherIcon = useMemo(() => {
    if (typeof weatherCode !== 'number') return null;
    // WMO weather interpretation codes (Open-Meteo).
    if (weatherCode === 0) return <Sun className="size-4 text-amber-400" aria-hidden="true" />;
    if (weatherCode === 1 || weatherCode === 2) return <Cloud className="size-4 text-slate-300" aria-hidden="true" />;
    if (weatherCode === 3) return <Cloud className="size-4 text-slate-400" aria-hidden="true" />;
    if (weatherCode === 45 || weatherCode === 48) return <CloudFog className="size-4 text-slate-400" aria-hidden="true" />;
    if (weatherCode >= 51 && weatherCode <= 57)
      return <CloudDrizzle className="size-4 text-sky-300" aria-hidden="true" />;
    if (weatherCode >= 61 && weatherCode <= 67)
      return <CloudRain className="size-4 text-sky-400" aria-hidden="true" />;
    if (weatherCode >= 71 && weatherCode <= 77)
      return <CloudSnow className="size-4 text-slate-200" aria-hidden="true" />;
    if (weatherCode >= 80 && weatherCode <= 82)
      return <CloudRain className="size-4 text-sky-400" aria-hidden="true" />;
    if (weatherCode >= 85 && weatherCode <= 86)
      return <CloudSnow className="size-4 text-slate-200" aria-hidden="true" />;
    if (weatherCode >= 95 && weatherCode <= 99)
      return <CloudLightning className="size-4 text-amber-300" aria-hidden="true" />;
    return <Cloud className="size-4 text-slate-300" aria-hidden="true" />;
  }, [weatherCode]);

  const handleUndoWaypoint = () => {
    setMissionWaypoints((prev) => prev.slice(0, -1));
  };

  const handleClearWaypoints = () => {
    setMissionWaypoints([]);
    setMissionRoute(null);
    setRouteAlternatives([]);
    setSelectedRouteIndex(0);
    setRouteSteps([]);
    setHoveredRouteIndex(null);
    setMissionDistance(0);
    setMissionEta(0);
  };

  const handleSelectRoute = (index: number) => {
    const selected = routeAlternatives[index];
    if (!selected) return;
    setSelectedRouteIndex(index);
    selectedRouteIndexRef.current = index;
    setMissionRoute({ type: 'LineString', coordinates: selected.coordinates });
    setRouteSteps(selected.steps);
    setMissionDistance(selected.distance);
    setMissionEta(selected.duration);
    triggerRouteFocus();
  };

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

  const handleDeleteMission = async () => {
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
  };

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
                    <IndicatorsRow
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
                  <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 md:absolute md:bottom-5 md:left-5 md:translate-x-0">
                    <div className="pointer-events-auto flex max-w-[95vw] items-center gap-3 rounded-full border border-border/[0.02] bg-card/30 px-3 py-2 shadow-lg backdrop-blur-lg">
                      <IndicatorsRow
                        deviceOnline={deviceOnline}
                        gamepadConnected={displayGamepadConnected}
                        driveMode={driveMode}
                        onDeviceClick={handleDeviceIndicatorClick}
                        onControllerClick={handleControllerIndicatorClick}
                        onAutoClick={handleAutoIndicatorClick}
                      />
                      <div className="h-5 w-px bg-border/70" />
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-card/90 backdrop-blur"
                        onClick={() => setFollowVehicleMap(true)}
                        title="Follow vehicle"
                      >
                        <GoogleMapsLocationIcon className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-card/90 backdrop-blur"
                        onClick={() => setMapThemesOpen(true)}
                        title="Map themes"
                      >
                        <Layers className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-card/90 backdrop-blur"
                        onClick={() => setMissionOverlayOpen(true)}
                        title="Mission planner"
                      >
                        <Flag className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-card/90 backdrop-blur"
                        onClick={() => setSearchOpen(true)}
                        title="Search location"
                      >
                        <Search className="size-4" />
                      </Button>
                    </div>
                  </div>
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
                  <IndicatorsRow
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
                <IndicatorsRow
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
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/70 bg-card/95 px-4 py-2 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Latitude</span>
              <span>{formatCoordValue(latestLocation?.lat)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Longitude</span>
              <span>{formatCoordValue(latestLocation?.lng)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Heading</span>
              <span>{headingLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <Compass className="size-4 text-foreground" aria-hidden="true" />
              <span className="sr-only">Compass</span>
              <span>{compassLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Velocity</span>
              <span>{speedLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Distance</span>
              <span>{missionDistanceLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">ETA</span>
              <span>{missionEtaLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Weather</span>
              {weatherIcon}
              <span>{weatherStatusLabel}</span>
            </div>
          </div>
        </div>
      )}
      {shouldShowMissionOverlay && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/55 px-4 py-8 backdrop-blur-sm">
          <div className="relative w-full max-w-xl rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelMissionPrompt}
              className="absolute right-3 top-3"
              aria-label="Close mission overlay"
            >
              <X className="size-4" />
            </Button>
            {missionPrompt === 'select' && (
              <div className="space-y-4">
                <div className="text-lg font-semibold">Select a mission</div>
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
                <div className="text-lg font-semibold">Confirm mission</div>
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
          </div>
        </div>
      )}
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
      <OverlayModal
        open={searchOpen}
        title="Search"
        onClose={() => {
          setSearchOpen(false);
          setSearchActionsOpen(false);
        }}
        maxWidthClassName="max-w-md"
      >
        <div className="grid gap-3 text-sm">
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="City, landmark, or lat,lng"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleSearchSubmit();
              }
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void handleSearchSubmit()}>
              <Search className="mr-2 size-4" />
              Search
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSearchActionsOpen((prev) => !prev)}
            >
              <ChevronDown className="mr-2 size-4" />
              Route actions
            </Button>
          </div>
          {searchStatus && <div className="text-xs text-muted-foreground">{searchStatus}</div>}
          {searchActionsOpen && (
            <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddSearchWaypoint}
                disabled={!lastSearchCoords || !planningEnabled}
                title={planningEnabled ? 'Add waypoint at search result' : 'Enable planning to add waypoints'}
                className="justify-start"
              >
                <Flag className="mr-2 size-4" />
                Add waypoint
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="justify-start"
                onClick={openSavePrompt}
                disabled={!missionCanSave}
                title={missionCanSave ? 'Save route to missions' : 'Add at least 2 waypoints'}
              >
                <ChevronRight className="mr-2 size-4" />
                Save route
              </Button>
              {savePromptOpen && (
                <div className="mt-1 grid gap-2 rounded-md border border-border/70 bg-background/60 p-2">
                  <div className="text-xs text-muted-foreground">Save route as</div>
                  <Input
                    value={savePromptName}
                    onChange={(event) => setSavePromptName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleSavePromptConfirm();
                      }
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => void handleSavePromptConfirm()}>
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSavePromptOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </OverlayModal>
      <OverlayModal
        open={missionOverlayOpen}
        title="Mission"
        onClose={() => {
          setMissionOverlayOpen(false);
          setShowMissionPlanner(false);
        }}
        maxWidthClassName="max-w-4xl"
      >
        <div className="grid gap-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {missionWaypoints.length} waypoints • {missionDistanceLabel} • {missionEtaLabel}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={planningEnabled ? 'default' : 'outline'}
                onClick={() => setPlanningEnabled(!planningEnabled)}
              >
                {planningEnabled ? 'Planning on' : 'Planning off'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowMissionPlanner((prev) => !prev)}>
                <ChevronDown className="mr-2 size-4" />
                {showMissionPlanner ? 'Hide planner' : 'Show planner'}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 rounded-lg border border-border/70 bg-muted/20 p-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddSearchWaypoint}
              disabled={!lastSearchCoords}
              title={lastSearchCoords ? 'Add last search location as waypoint' : 'Search first to add'}
            >
              <Plus className="mr-2 size-4" />
              Add last search
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleUndoWaypoint}
              disabled={!missionWaypoints.length}
            >
              <RotateCcw className="mr-2 size-4" />
              Undo
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleClearWaypoints}
              disabled={!missionWaypoints.length}
            >
              <Trash2 className="mr-2 size-4" />
              Clear route
            </Button>
          </div>
          <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Path type</span>
              <span>{missionPathType}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Profile</span>
              <span>{missionProfile}</span>
            </div>
            {routingStatus && <div className="text-muted-foreground">{routingStatus}</div>}
          </div>
          {plannerMounted && (
            <div className={showMissionPlanner ? 'block' : 'hidden'}>
              <MissionPlannerTabs {...missionPlannerProps} />
            </div>
          )}
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


