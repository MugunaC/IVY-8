import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { VehicleLocation } from '@/app/hooks/useVehicleLocationFeed';
import type { MissionWaypoint } from '@shared/types';

interface MapPanelProps {
  location: VehicleLocation | null;
  peerLocations?: Array<VehicleLocation & { username?: string }>;
  isConnected: boolean;
  error?: string | null;
  className?: string;
  mapClassName?: string;
  hideStats?: boolean;
  style?: maplibregl.StyleSpecification | string;
  mapOverlay?: React.ReactNode;
  waypoints?: MissionWaypoint[];
  route?: { type: 'LineString'; coordinates: [number, number][] } | null;
  sharedRoute?: { type: 'LineString'; coordinates: [number, number][] } | null;
  alternativeRoutes?: Array<{ type: 'LineString'; coordinates: [number, number][] }>;
  selectedAlternativeIndex?: number | null;
  highlightedAlternativeIndex?: number | null;
  onMapClick?: (lng: number, lat: number) => void;
  onMapRightClick?: (lng: number, lat: number) => void;
  onWaypointDrag?: (index: number, lng: number, lat: number) => void;
  onWaypointClick?: (index: number) => void;
  showWaypoints?: boolean;
  draggableWaypoints?: boolean;
  followHeading?: boolean;
  followLocation?: boolean;
  syncKey?: string;
  syncMode?: 'write' | 'read' | 'off';
  autoFitRouteSignal?: number;
  focusRequest?: { center: [number, number]; zoom?: number; signal: number };
  hideHeader?: boolean;
  edgeToEdge?: boolean;
}

const DETAILED_FALLBACK_STYLE: maplibregl.StyleSpecification = {
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
      attribution: 'Tiles © Esri',
    },
  },
  layers: [
    {
      id: 'topo-base',
      type: 'raster',
      source: 'topo',
    },
  ],
};

if (!maplibregl.getWorkerUrl()) {
  maplibregl.setWorkerUrl(
    new URL('maplibre-gl/dist/maplibre-gl-csp-worker.js', import.meta.url).toString()
  );
}

function formatCoord(value: number | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return value.toFixed(6);
}

export function MapPanel(props: MapPanelProps) {
  const {
    location,
    isConnected,
    error,
    className,
    mapClassName,
    hideStats = false,
    style,
    mapOverlay,
    hideHeader = false,
    edgeToEdge = false,
  } = props;
  const showWaypoints = props.showWaypoints ?? true;
  const [isVisible, setIsVisible] = useState(true);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const markerNodeRef = useRef<HTMLDivElement | null>(null);
  const peerMarkersRef = useRef<maplibregl.Marker[]>([]);
  const waypointMarkersRef = useRef<maplibregl.Marker[]>([]);
  const routeRef = useRef<MapPanelProps['route']>(null);
  const altRoutesRef = useRef<MapPanelProps['alternativeRoutes']>([]);
  const routeLayersRef = useRef<{ layers: string[]; sources: string[] }>({ layers: [], sources: [] });
  const altLineIdsRef = useRef<string[]>([]);
  const onMapClickRef = useRef<MapPanelProps['onMapClick'] | null>(null);
  const onMapRightClickRef = useRef<MapPanelProps['onMapRightClick'] | null>(null);
  const onWaypointDragRef = useRef<MapPanelProps['onWaypointDrag'] | null>(null);
  const onWaypointClickRef = useRef<MapPanelProps['onWaypointClick'] | null>(null);
  const followHeadingRef = useRef<boolean | undefined>(props.followHeading);
  const followLocationRef = useRef<boolean | undefined>(props.followLocation);
  const selectedAlternativeIndexRef = useRef<number | null>(props.selectedAlternativeIndex ?? null);
  const latestRef = useRef<VehicleLocation | null>(null);
  const lastAppliedTsRef = useRef<number>(0);
  const lastCameraUpdateMsRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const lastFrameMsRef = useRef<number>(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const isVisibleRef = useRef(true);
  const syncKeyRef = useRef<string | null>(props.syncKey ?? null);
  const syncWriterRef = useRef<(() => void) | null>(null);
  const lastSyncTsRef = useRef<number>(0);
  const applyingSyncRef = useRef(false);
  const hasSyncedViewRef = useRef(false);
  const lastAutoFitSignalRef = useRef<number | null>(null);
  const syncModeRef = useRef<MapPanelProps['syncMode']>(props.syncMode ?? (props.syncKey ? 'write' : 'off'));
  const lastFocusSignalRef = useRef<number | null>(null);

  const statusText = useMemo(() => {
    if (error) return `Error: ${error}`;
    return isConnected ? 'Connected' : 'Disconnected';
  }, [error, isConnected]);

  useEffect(() => {
    latestRef.current = location;
  }, [location]);

  useEffect(() => {
    onMapClickRef.current = props.onMapClick || null;
  }, [props.onMapClick]);

  useEffect(() => {
    onMapRightClickRef.current = props.onMapRightClick || null;
  }, [props.onMapRightClick]);

  useEffect(() => {
    routeRef.current = props.route || null;
  }, [props.route]);

  useEffect(() => {
    altRoutesRef.current = props.alternativeRoutes || [];
  }, [props.alternativeRoutes]);

  useEffect(() => {
    onWaypointDragRef.current = props.onWaypointDrag || null;
  }, [props.onWaypointDrag]);

  useEffect(() => {
    onWaypointClickRef.current = props.onWaypointClick || null;
  }, [props.onWaypointClick]);

  useEffect(() => {
    followHeadingRef.current = props.followHeading;
  }, [props.followHeading]);

  useEffect(() => {
    followLocationRef.current = props.followLocation;
    if (props.followLocation) {
      hasSyncedViewRef.current = false;
    }
  }, [props.followLocation]);

  useEffect(() => {
    selectedAlternativeIndexRef.current = props.selectedAlternativeIndex ?? null;
  }, [props.selectedAlternativeIndex]);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    const node = mapContainerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const clearRouteLayers = (map: maplibregl.Map) => {
    routeLayersRef.current.layers.forEach((id) => {
      if (map.getLayer(id)) {
        map.removeLayer(id);
      }
    });
    routeLayersRef.current.sources.forEach((id) => {
      if (map.getSource(id)) {
        map.removeSource(id);
      }
    });
    routeLayersRef.current = { layers: [], sources: [] };
    altLineIdsRef.current = [];
  };

  const applyRoutes = useCallback((
    nextRoute: MapPanelProps['route'],
    alternativeRoutes: MapPanelProps['alternativeRoutes'] = [],
    selectedAlternativeIndex?: number | null
  ) => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once('style.load', () => applyRoutes(nextRoute, alternativeRoutes, selectedAlternativeIndex));
      return;
    }
    clearRouteLayers(map);

    const renderRoute = (
      route: MapPanelProps['route'],
      index: number,
      variant: 'primary' | 'alt' | 'shared'
    ) => {
      const sourceId =
        variant === 'primary'
          ? 'mission-route'
          : variant === 'shared'
            ? 'mission-route-shared'
            : `mission-route-alt-${index}`;
      const outlineId = `${sourceId}-outline`;
      const lineId = `${sourceId}-line`;
      routeLayersRef.current.layers.push(outlineId, lineId);
      routeLayersRef.current.sources.push(sourceId);
      if (!route || route.coordinates.length < 2) return;
      const data = {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: route.coordinates,
        },
        properties: {},
      };
      map.addSource(sourceId, {
        type: 'geojson',
        data,
      });
      if (variant === 'primary' || variant === 'shared') {
        map.addLayer({
          id: outlineId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': variant === 'shared' ? '#7c2d12' : '#0f172a',
            'line-width': variant === 'shared' ? 5 : 6,
            'line-opacity': variant === 'shared' ? 0.7 : 0.65,
          },
        });
        map.addLayer({
          id: lineId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': variant === 'shared' ? '#f59e0b' : '#38bdf8',
            'line-width': variant === 'shared' ? 3 : 3,
            ...(variant === 'shared' ? { 'line-dasharray': [2, 1.25] } : {}),
          },
        });
      } else {
        altLineIdsRef.current[index] = lineId;
        map.addLayer({
          id: lineId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': '#94a3b8',
            'line-width': 2,
            'line-opacity': 0.65,
            'line-dasharray': [2, 2],
          },
        });
      }
    };

    if (!nextRoute && !props.sharedRoute && (!alternativeRoutes || alternativeRoutes.length === 0)) {
      return;
    }
    if (alternativeRoutes && alternativeRoutes.length > 0) {
      alternativeRoutes.forEach((route, index) => {
        if (selectedAlternativeIndex === index) return;
        renderRoute(route, index, 'alt');
      });
    }
    if (nextRoute) {
      renderRoute(nextRoute, 0, 'primary');
    }
    if (props.sharedRoute) {
      renderRoute(props.sharedRoute, 0, 'shared');
    }
  }, [props.sharedRoute]);

  const applySyncedView = useCallback((raw: string) => {
    const map = mapRef.current;
    if (!map) return;
    let parsed: {
      center?: [number, number];
      zoom?: number;
      bearing?: number;
      pitch?: number;
      ts?: number;
    } | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || !Array.isArray(parsed.center) || parsed.center.length !== 2) return;
    const ts = typeof parsed.ts === 'number' ? parsed.ts : 0;
    if (ts <= lastSyncTsRef.current) return;
    applyingSyncRef.current = true;
    hasSyncedViewRef.current = true;
    map.jumpTo({
      center: parsed.center,
      zoom: typeof parsed.zoom === 'number' ? parsed.zoom : map.getZoom(),
      bearing: typeof parsed.bearing === 'number' ? parsed.bearing : map.getBearing(),
      pitch: typeof parsed.pitch === 'number' ? parsed.pitch : map.getPitch(),
    });
    map.once('moveend', () => {
      lastSyncTsRef.current = ts;
      applyingSyncRef.current = false;
    });
  }, []);

  const writeSyncedView = useCallback(() => {
    const key = syncKeyRef.current;
    const map = mapRef.current;
    if (!key || !map) return;
    if (applyingSyncRef.current) return;
    const center = map.getCenter();
    const payload = {
      center: [center.lng, center.lat] as [number, number],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      ts: Date.now(),
    };
    try {
      window.localStorage.setItem(`ivy.mapView.${key}`, JSON.stringify(payload));
      lastSyncTsRef.current = payload.ts;
      hasSyncedViewRef.current = true;
    } catch {
      // ignore storage failures
    }
  }, []);

  useEffect(() => {
    syncKeyRef.current = props.syncKey ?? null;
  }, [props.syncKey]);

  useEffect(() => {
    syncWriterRef.current = writeSyncedView;
  }, [writeSyncedView]);

  useEffect(() => {
    syncModeRef.current = props.syncMode ?? (props.syncKey ? 'write' : 'off');
  }, [props.syncMode, props.syncKey]);

  useEffect(() => {
    const key = props.syncKey;
    if (!key) return;
    if (syncModeRef.current === 'off') return;
    const storageKey = `ivy.mapView.${key}`;
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      applySyncedView(stored);
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      applySyncedView(event.newValue);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [props.syncKey, applySyncedView]);

  useEffect(() => {
    const signal = props.autoFitRouteSignal;
    if (typeof signal !== 'number') return;
    if (lastAutoFitSignalRef.current === signal) return;
    lastAutoFitSignalRef.current = signal;
    const map = mapRef.current;
    if (!map) return;
    const route = props.route;
    const waypoints = props.waypoints || [];
    const coords =
      route && route.coordinates.length >= 2
        ? route.coordinates
        : waypoints.length >= 2
          ? waypoints.map((wp) => [wp.lng, wp.lat] as [number, number])
          : null;
    if (!coords || coords.length < 2) return;
    const applyFit = () => {
      const bounds = coords.reduce(
        (acc, coord) => acc.extend(coord),
        new maplibregl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, {
        padding: { top: 80, bottom: 80, left: 80, right: 80 },
        duration: 600,
        maxZoom: 16,
      });
    };
    if (!map.isStyleLoaded()) {
      map.once('style.load', applyFit);
      return;
    }
    applyFit();
  }, [props.autoFitRouteSignal, props.route, props.waypoints]);

  useEffect(() => {
    const request = props.focusRequest;
    if (!request || typeof request.signal !== 'number') return;
    if (lastFocusSignalRef.current === request.signal) return;
    lastFocusSignalRef.current = request.signal;
    const map = mapRef.current;
    if (!map) return;
    const applyFocus = () => {
      map.easeTo({
        center: request.center,
        zoom: typeof request.zoom === 'number' ? request.zoom : Math.max(12, map.getZoom()),
        duration: 700,
      });
    };
    if (!map.isStyleLoaded()) {
      map.once('style.load', applyFocus);
      return;
    }
    applyFocus();
  }, [props.focusRequest]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !isVisible) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: style || import.meta.env.VITE_MAP_STYLE_URL || DETAILED_FALLBACK_STYLE,
      center: [36.8219, -1.2921],
      zoom: 12,
      maxZoom: 20,
      attributionControl: false,
    });

    const markerNode = document.createElement('div');
    markerNode.className = 'size-4 rounded-full border-2 border-white bg-blue-500 shadow-lg';
    markerNodeRef.current = markerNode;

    const marker = new maplibregl.Marker({
      element: markerNode,
      rotationAlignment: 'map',
    })
      .setLngLat([36.8219, -1.2921])
      .addTo(map);

    mapRef.current = map;
    markerRef.current = marker;

    map.on('style.load', () => {
      applyRoutes(routeRef.current || null, altRoutesRef.current || [], selectedAlternativeIndexRef.current);
    });

    map.on('click', (event: maplibregl.MapMouseEvent) => {
      const handler = onMapClickRef.current;
      if (handler) {
        handler(event.lngLat.lng, event.lngLat.lat);
      }
    });

    map.on('contextmenu', (event: maplibregl.MapMouseEvent) => {
      event.preventDefault();
      const handler = onMapRightClickRef.current;
      if (handler) {
        handler(event.lngLat.lng, event.lngLat.lat);
      }
    });

    map.on('moveend', () => {
      if (syncModeRef.current !== 'write') return;
      syncWriterRef.current?.();
    });

    const tick = () => {
      const nowFrame = Date.now();
      const minInterval = isVisibleRef.current ? 16 : 150;
      if (nowFrame - lastFrameMsRef.current < minInterval) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrameMsRef.current = nowFrame;
      if (!isVisibleRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const next = latestRef.current;
      if (next && next.ts !== lastAppliedTsRef.current) {
        lastAppliedTsRef.current = next.ts;
        marker.setLngLat([next.lng, next.lat]);
        marker.setRotation(next.heading || 0);

        if (followLocationRef.current !== false && !(syncModeRef.current === 'read' && hasSyncedViewRef.current)) {
          const now = Date.now();
          if (now - lastCameraUpdateMsRef.current >= 100) {
            lastCameraUpdateMsRef.current = now;
            const nextBearing =
              typeof next.heading === 'number' && followHeadingRef.current ? next.heading : undefined;
            map.jumpTo({ center: [next.lng, next.lat], bearing: nextBearing ?? map.getBearing() });
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    // Ensure the map resizes correctly if its container size changes (e.g. toggled panels).
    if (mapContainerRef.current) {
      resizeObserverRef.current = new ResizeObserver(() => {
        map.resize();
      });
      resizeObserverRef.current.observe(mapContainerRef.current);
    }
    map.once('load', () => map.resize());

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      marker.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      markerNodeRef.current = null;
      peerMarkersRef.current.forEach((item) => item.remove());
      peerMarkersRef.current = [];
      waypointMarkersRef.current.forEach((item) => item.remove());
      waypointMarkersRef.current = [];
    };
  }, [applyRoutes, isVisible, style]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const highlighted = props.highlightedAlternativeIndex ?? null;
    altLineIdsRef.current.forEach((lineId, index) => {
      if (!lineId || !map.getLayer(lineId)) return;
      const isHighlighted = highlighted === index;
      map.setPaintProperty(lineId, 'line-color', isHighlighted ? '#f97316' : '#94a3b8');
      map.setPaintProperty(lineId, 'line-width', isHighlighted ? 4 : 2);
      map.setPaintProperty(lineId, 'line-opacity', isHighlighted ? 0.9 : 0.65);
    });
  }, [props.highlightedAlternativeIndex, props.alternativeRoutes]);

  useEffect(() => {
    if (!mapRef.current || !style) return;
    mapRef.current.setStyle(style);
  }, [style]);

  useEffect(() => {
    applyRoutes(props.route || null, props.alternativeRoutes || [], props.selectedAlternativeIndex ?? null);
  }, [applyRoutes, props.route, props.sharedRoute, props.alternativeRoutes, props.selectedAlternativeIndex]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    peerMarkersRef.current.forEach((marker) => marker.remove());
    peerMarkersRef.current = [];
    peerMarkersRef.current = (props.peerLocations || [])
      .filter((entry) => Number.isFinite(entry.lat) && Number.isFinite(entry.lng))
      .map((entry) => {
        const markerNode = document.createElement('div');
        markerNode.className =
          'flex min-w-[2rem] items-center justify-center rounded-full border border-white/80 bg-amber-500 px-2 py-1 text-[10px] font-semibold text-slate-950 shadow';
        markerNode.textContent = entry.username || entry.vehicleId;
        return new maplibregl.Marker({ element: markerNode })
          .setLngLat([entry.lng, entry.lat])
          .addTo(map);
      });
    return () => {
      peerMarkersRef.current.forEach((marker) => marker.remove());
      peerMarkersRef.current = [];
    };
  }, [props.peerLocations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    waypointMarkersRef.current.forEach((marker) => marker.remove());
    waypointMarkersRef.current = [];
    const ghostSourceId = 'waypoint-ghost';
    const ghostLineId = 'waypoint-ghost-line';
    const clearGhost = () => {
      if (!map.isStyleLoaded()) return;
      if (map.getLayer(ghostLineId)) map.removeLayer(ghostLineId);
      if (map.getSource(ghostSourceId)) map.removeSource(ghostSourceId);
    };
    if (!showWaypoints) {
      clearGhost();
      return;
    }
    const waypoints = props.waypoints || [];
    if (!waypoints.length) {
      clearGhost();
      return;
    }
    const updateGhost = (index: number, lng: number, lat: number) => {
      if (!map.isStyleLoaded()) return;
      const coords = waypoints.map((point, idx) =>
        idx === index ? ([lng, lat] as [number, number]) : ([point.lng, point.lat] as [number, number])
      );
      if (coords.length < 2) {
        clearGhost();
        return;
      }
      const data = {
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: coords },
        properties: {},
      };
      const existing = map.getSource(ghostSourceId);
      if (existing && 'setData' in existing) {
        (existing as maplibregl.GeoJSONSource).setData(data);
      } else {
        map.addSource(ghostSourceId, { type: 'geojson', data });
        map.addLayer({
          id: ghostLineId,
          type: 'line',
          source: ghostSourceId,
          paint: {
            'line-color': '#38bdf8',
            'line-width': 2,
            'line-opacity': 0.6,
            'line-dasharray': [1, 2],
          },
        });
      }
    };
    waypointMarkersRef.current = waypoints.map((point, index) => {
      const markerNode = document.createElement('div');
      markerNode.className =
        'flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-900 text-xs font-semibold text-white shadow';
      markerNode.textContent = String(index + 1);
      markerNode.style.cursor = 'pointer';
      markerNode.addEventListener('click', (event) => {
        event.stopPropagation();
        onWaypointClickRef.current?.(index);
      });
      const marker = new maplibregl.Marker({
        element: markerNode,
        draggable: Boolean(props.draggableWaypoints),
      })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
      if (props.draggableWaypoints) {
        marker.on('dragstart', () => {
          const lngLat = marker.getLngLat();
          updateGhost(index, lngLat.lng, lngLat.lat);
        });
        marker.on('drag', () => {
          const lngLat = marker.getLngLat();
          updateGhost(index, lngLat.lng, lngLat.lat);
        });
        marker.on('dragend', () => {
          const lngLat = marker.getLngLat();
          clearGhost();
          onWaypointDragRef.current?.(index, lngLat.lng, lngLat.lat);
        });
      }
      return marker;
    });
    return () => {
      if (!map.isStyleLoaded()) return;
      clearGhost();
    };
  }, [props.waypoints, showWaypoints, props.draggableWaypoints]);

  const containerClassName = edgeToEdge
    ? `relative h-full w-full ${className || ''}`
    : `rounded-xl border border-border bg-card p-4 ${className || ''}`;

  return (
    <section className={containerClassName}>
      {!hideHeader && !edgeToEdge && (
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Map</h3>
          <span className="text-xs text-muted-foreground">{statusText}</span>
        </header>
      )}

      <div
        className={`map-overlay-host relative overflow-visible ${
          edgeToEdge ? 'mb-0 h-full border-0 rounded-none' : 'mb-3 h-56 rounded-lg border border-border/60'
        } ${mapClassName || ''}`}
      >
        <div
          ref={mapContainerRef}
          className={`h-full w-full overflow-hidden ${edgeToEdge ? 'rounded-none' : 'rounded-lg'}`}
        />
        {mapOverlay && <div className="absolute inset-0 z-30 pointer-events-none">{mapOverlay}</div>}
      </div>

      {!hideStats && (
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Latitude</p>
            <p className="font-medium">{formatCoord(location?.lat)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Longitude</p>
            <p className="font-medium">{formatCoord(location?.lng)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Heading</p>
            <p className="font-medium">
              {typeof location?.heading === 'number' ? `${location.heading.toFixed(1)} deg` : '--'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Speed (km/h)</p>
            <p className="font-medium">
              {typeof location?.speedMps === 'number'
                ? `${(location.speedMps * 3.6).toFixed(1)} km/h`
                : '--'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
