import type { MissionPathType, MissionWaypoint } from '@shared/types';
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp';

export const MAP_THEMES: Array<{ key: string; label: string; style: maplibregl.StyleSpecification }> = [
  {
    key: 'topo',
    label: 'Topo',
    style: {
      version: 8,
      sources: {
        topo: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
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
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
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
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
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
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
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
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
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
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}'],
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
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
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

export const round = (value: number, decimals: number) => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

export const OSRM_URL = import.meta.env.VITE_OSRM_URL || import.meta.env.VITE_ROUTING_URL;
export const WEATHER_URL = import.meta.env.VITE_WEATHER_URL;

type OsrmManeuver = {
  type?: string;
  modifier?: string;
  exit?: number;
};

export type OsrmStep = {
  name?: string;
  distance?: number;
  duration?: number;
  maneuver?: OsrmManeuver;
};

export type RouteAlternative = {
  coordinates: [number, number][];
  distance: number;
  duration: number;
  steps: OsrmStep[];
};

export type InstructionLocale = 'en' | 'sw';

export const resolveInstructionLocale = (): InstructionLocale => {
  const lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language.toLowerCase() : 'en';
  return lang.startsWith('sw') ? 'sw' : 'en';
};

const toRad = (value: number) => (value * Math.PI) / 180;

export const haversineDistance = (a: MissionWaypoint, b: MissionWaypoint) => {
  const r = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
};

export const computeRouteDistance = (coords: [number, number][]) => {
  if (coords.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < coords.length; i += 1) {
    sum += haversineDistance({ lng: coords[i - 1][0], lat: coords[i - 1][1] }, { lng: coords[i][0], lat: coords[i][1] });
  }
  return sum;
};

export const formatMeters = (value: number) => {
  if (!Number.isFinite(value)) return '--';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
  return `${Math.round(value)} m`;
};

export const formatEta = (value: number) => {
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

export const headingToCompass = (heading: number | undefined) => {
  if (typeof heading !== 'number' || Number.isNaN(heading)) return '--';
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(((heading % 360) + 360) / 45) % 8;
  return directions[index];
};

export const formatCoordValue = (value: number | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return value.toFixed(6);
};

export const formatStepInstruction = (step: OsrmStep, locale: InstructionLocale) => {
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
          roundabout: (exit?: number) => (exit ? `Ingiza kwenye mzunguko na chukua kutoka ${exit}` : 'Ingiza kwenye mzunguko'),
          exitRoundabout: 'Toka kwenye mzunguko',
          continue: 'Endelea',
          continueOn: (road: string) => (road ? `Endelea kwenye ${road}` : 'Endelea'),
          turn: (dir: string) => (dir ? `Geuka ${dir}` : 'Geuka'),
          turnOnto: (dir: string, road: string) => (road ? `Geuka ${dir} kwenye ${road}` : `Geuka ${dir}`),
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
          roundabout: (exit?: number) => (exit ? `Enter roundabout and take exit ${exit}` : 'Enter roundabout'),
          exitRoundabout: 'Exit roundabout',
          continue: 'Continue',
          continueOn: (road: string) => (road ? `Continue on ${road}` : 'Continue'),
          turn: (dir: string) => (dir ? `Turn ${dir}` : 'Turn'),
          turnOnto: (dir: string, road: string) => (road ? `Turn ${dir} onto ${road}` : `Turn ${dir}`),
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

export const formatWaypointPreview = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

export const resolveEffectivePathType = (profile: 'rover' | 'drone', pathType: MissionPathType) =>
  profile === 'drone' ? 'straight' : pathType;
