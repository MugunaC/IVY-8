import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Sun } from 'lucide-react';
import type { MissionPathType, MissionWaypoint } from '@shared/types';
import type { VehicleLocation } from '@/app/hooks/useVehicleLocationFeed';
import {
  computeRouteDistance,
  OSRM_URL,
  type RouteAlternative,
  resolveEffectivePathType,
  type OsrmStep,
  WEATHER_URL,
} from '@/app/components/realtime/focus/focusMapUtils';

type UseFocusMapRoutingWeatherOptions = {
  waypoints: MissionWaypoint[];
  pathType: MissionPathType;
  profile: 'rover' | 'drone';
  speedMps: number;
  latestLocation: VehicleLocation | null;
  onRouteResolved: (route: { type: 'LineString'; coordinates: [number, number][] } | null, distance: number, eta: number) => void;
  onRouteFocus: () => void;
};

export function useFocusMapRoutingWeather(options: UseFocusMapRoutingWeatherOptions) {
  const { waypoints, pathType, profile, speedMps, latestLocation, onRouteResolved, onRouteFocus } = options;
  const [routeAlternatives, setRouteAlternatives] = useState<RouteAlternative[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeSteps, setRouteSteps] = useState<OsrmStep[]>([]);
  const [hoveredRouteIndex, setHoveredRouteIndex] = useState<number | null>(null);
  const [routingStatus, setRoutingStatus] = useState<string | null>(null);
  const [weatherSummary, setWeatherSummary] = useState('');
  const [weatherUnavailableReason, setWeatherUnavailableReason] = useState('');
  const [weatherCode, setWeatherCode] = useState<number | null>(null);
  const selectedRouteIndexRef = useRef(0);
  const lastWeatherFetchRef = useRef(0);
  const onRouteResolvedRef = useRef(onRouteResolved);
  const onRouteFocusRef = useRef(onRouteFocus);

  useEffect(() => {
    selectedRouteIndexRef.current = selectedRouteIndex;
  }, [selectedRouteIndex]);

  useEffect(() => {
    onRouteResolvedRef.current = onRouteResolved;
    onRouteFocusRef.current = onRouteFocus;
  }, [onRouteFocus, onRouteResolved]);

  useEffect(() => {
    const coords = waypoints.map((point) => [point.lng, point.lat] as [number, number]);
    if (coords.length < 2) {
      setRouteAlternatives([]);
      setSelectedRouteIndex(0);
      setRouteSteps([]);
      setHoveredRouteIndex(null);
      onRouteResolvedRef.current(null, 0, 0);
      setRoutingStatus(null);
      return;
    }

    const effectivePathType = resolveEffectivePathType(profile, pathType);
    if (profile === 'drone' && pathType === 'roads') {
      setRoutingStatus('Drone profile uses straight-line routing.');
    }

    if (effectivePathType === 'straight' || !OSRM_URL) {
      if (effectivePathType === 'roads' && !OSRM_URL) {
        setRoutingStatus('OSRM URL not configured, using straight-line path.');
      } else if (effectivePathType !== 'straight' || profile !== 'drone') {
        setRoutingStatus(null);
      }
      const distance = computeRouteDistance(coords);
      setRouteAlternatives([]);
      setSelectedRouteIndex(0);
      setRouteSteps([]);
      setHoveredRouteIndex(null);
      onRouteResolvedRef.current(
        { type: 'LineString', coordinates: coords },
        distance,
        speedMps > 0 ? distance / speedMps : 0
      );
      return;
    }

    let cancelled = false;
    const buildRoutingUrl = (points: [number, number][]) => {
      const joined = points.map((item) => `${item[0]},${item[1]}`).join(';');
      const base = OSRM_URL.replace(/\/+$/, '');
      const prefix = base.includes('route/v1') ? base : `${base}/route/v1/driving`;
      return `${prefix}/${joined}?overview=full&geometries=geojson&steps=true&alternatives=true`;
    };

    const fetchRoute = async () => {
      setRoutingStatus('Fetching road route...');
      try {
        const response = await fetch(buildRoutingUrl(coords));
        if (!response.ok) throw new Error(`Routing failed (${response.status})`);
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
            const duration = route.duration ?? (speedMps > 0 ? distance / speedMps : 0);
            const steps = route.legs?.flatMap((leg) => leg.steps || []) ?? [];
            return { coordinates: routeCoords, distance, duration, steps };
          }) ?? [];

        if (!routes.length) {
          const distance = computeRouteDistance(coords);
          setRouteAlternatives([]);
          setSelectedRouteIndex(0);
          setRouteSteps([]);
          setHoveredRouteIndex(null);
          onRouteResolvedRef.current(
            { type: 'LineString', coordinates: coords },
            distance,
            speedMps > 0 ? distance / speedMps : 0
          );
          setRoutingStatus('Routing response returned no routes. Using straight-line path.');
          return;
        }

        const nextIndex = Math.min(selectedRouteIndexRef.current, routes.length - 1);
        const selected = routes[nextIndex];
        setRouteAlternatives(routes);
        setSelectedRouteIndex(nextIndex);
        setRouteSteps(selected.steps);
        setHoveredRouteIndex(null);
        onRouteResolvedRef.current(
          { type: 'LineString', coordinates: selected.coordinates },
          selected.distance,
          selected.duration
        );
        setRoutingStatus(null);
      } catch (error) {
        if (cancelled) return;
        const distance = computeRouteDistance(coords);
        setRouteAlternatives([]);
        setSelectedRouteIndex(0);
        setRouteSteps([]);
        setHoveredRouteIndex(null);
        onRouteResolvedRef.current(
          { type: 'LineString', coordinates: coords },
          distance,
          speedMps > 0 ? distance / speedMps : 0
        );
        setRoutingStatus(error instanceof Error ? `${error.message}. Using straight-line path.` : 'Routing failed. Using straight-line path.');
      }
    };

    void fetchRoute();
    return () => {
      cancelled = true;
    };
  }, [pathType, profile, speedMps, waypoints]);

  useEffect(() => {
    if (!WEATHER_URL) {
      setWeatherSummary('');
      setWeatherUnavailableReason('Weather API not configured');
      setWeatherCode(null);
      return;
    }
    if (!latestLocation) {
      setWeatherSummary('');
      setWeatherUnavailableReason('Waiting for GPS fix');
      setWeatherCode(null);
      return;
    }
    const now = Date.now();
    if (now - lastWeatherFetchRef.current < 60_000) return;
    lastWeatherFetchRef.current = now;
    setWeatherUnavailableReason('');

    const buildWeatherUrl = () => {
      if (WEATHER_URL.includes('{lat}') || WEATHER_URL.includes('{lng}')) {
        return WEATHER_URL.replace('{lat}', String(latestLocation.lat)).replace('{lng}', String(latestLocation.lng));
      }
      const separator = WEATHER_URL.includes('?') ? '&' : '?';
      return `${WEATHER_URL}${separator}lat=${latestLocation.lat}&lng=${latestLocation.lng}`;
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
        const code = typeof data.current_weather?.weathercode === 'number' ? data.current_weather.weathercode : null;
        const summary = data.summary || (temp !== undefined ? `${temp}°C` : '') + (wind !== undefined ? ` • wind ${wind} m/s` : '');
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
  }, [latestLocation]);

  const handleSelectRoute = useCallback(
    (index: number) => {
      const selected = routeAlternatives[index];
      if (!selected) return;
      setSelectedRouteIndex(index);
      selectedRouteIndexRef.current = index;
      setRouteSteps(selected.steps);
      setHoveredRouteIndex(null);
      onRouteResolvedRef.current(
        { type: 'LineString', coordinates: selected.coordinates },
        selected.distance,
        selected.duration
      );
      onRouteFocusRef.current();
    },
    [routeAlternatives]
  );

  const weatherStatusLabel = weatherSummary || (weatherUnavailableReason ? `Unavailable: ${weatherUnavailableReason}` : 'Unavailable');

  const weatherIcon = useMemo(() => {
    if (typeof weatherCode !== 'number') return null;
    if (weatherCode === 0) return createElement(Sun, { className: 'size-4 text-amber-400', 'aria-hidden': 'true' });
    if (weatherCode === 1 || weatherCode === 2) return createElement(Cloud, { className: 'size-4 text-slate-300', 'aria-hidden': 'true' });
    if (weatherCode === 3) return createElement(Cloud, { className: 'size-4 text-slate-400', 'aria-hidden': 'true' });
    if (weatherCode === 45 || weatherCode === 48) return createElement(CloudFog, { className: 'size-4 text-slate-400', 'aria-hidden': 'true' });
    if (weatherCode >= 51 && weatherCode <= 57) return createElement(CloudDrizzle, { className: 'size-4 text-cyan-300', 'aria-hidden': 'true' });
    if (weatherCode >= 61 && weatherCode <= 67) return createElement(CloudRain, { className: 'size-4 text-sky-300', 'aria-hidden': 'true' });
    if (weatherCode >= 71 && weatherCode <= 77) return createElement(CloudSnow, { className: 'size-4 text-slate-100', 'aria-hidden': 'true' });
    if (weatherCode >= 80 && weatherCode <= 82) return createElement(CloudRain, { className: 'size-4 text-sky-300', 'aria-hidden': 'true' });
    if (weatherCode >= 85 && weatherCode <= 86) return createElement(CloudSnow, { className: 'size-4 text-slate-100', 'aria-hidden': 'true' });
    if (weatherCode >= 95 && weatherCode <= 99) return createElement(CloudLightning, { className: 'size-4 text-amber-300', 'aria-hidden': 'true' });
    return createElement(Cloud, { className: 'size-4 text-slate-300', 'aria-hidden': 'true' });
  }, [weatherCode]);

  return {
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
  };
}
