import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/app/context/AuthContext';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { ControllerChatPanel } from '@/app/components/realtime/control/ControllerChatPanel';
import { ControllerPanelFallback } from '@/app/components/realtime/control/ControllerPanelFallback';
import { CoopLegend } from '@/app/components/realtime/coop/CoopLegend';
import { useVehicleLocationFeed } from '@/app/hooks/useVehicleLocationFeed';
import { useControlSocket } from '@/app/hooks/realtime/useControlSocket';
import { useFocusMapRoutingWeather } from '@/app/hooks/realtime/useFocusMapRoutingWeather';
import { useDebouncedValue } from '@/app/hooks/useDebouncedValue';
import { useCoopSession } from '@/app/hooks/useCoopSession';
import { getDefaultControlWsUrl, getDefaultLocationWsUrl } from '@/app/utils/wsUrls';
import { Copy, Eye, MapPinned, Plus, Trash2, Users } from 'lucide-react';
import type { MissionPathType, MissionWaypoint, WsServerMessage } from '@shared/types';

const MapPanel = lazy(async () => {
  const mod = await import('@/app/components/realtime/MapPanel');
  return { default: mod.MapPanel };
});

function round(value: number, decimals: number) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function CoopSessionPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const sessionId = params.sessionId || '';
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedRole = query.get('role') === 'spectator' ? 'spectator' : 'driver';
  const requestedVehicleId = query.get('vehicleId') || '';
  const [vehicleId, setVehicleId] = useState(requestedVehicleId);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [routingMode] = useState<MissionPathType>('roads');
  const [planningWaypoints, setPlanningWaypoints] = useState<MissionWaypoint[]>([]);
  const [planningRoute, setPlanningRoute] = useState<{ type: 'LineString'; coordinates: [number, number][] } | null>(null);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState(0);
  const [routeFocusSignal, setRouteFocusSignal] = useState(0);
  const [followVehicle, setFollowVehicle] = useState(true);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const routeVersionRef = useRef<number | null>(null);
  const lastSharedSignatureRef = useRef('');
  const skipNextShareRef = useRef(false);
  const coopHandlerRef = useRef<(message: WsServerMessage) => void>(() => {});

  useEffect(() => {
    setVehicleId(requestedVehicleId);
  }, [requestedVehicleId]);

  const controlWsUrl = useMemo(() => getDefaultControlWsUrl({ includeOverride: true }), []);
  const { wsRef, isConnected } = useControlSocket({
    url: controlWsUrl,
    vehicleId: vehicleId || 'COOP',
    onServerMessage: (message) => {
      coopHandlerRef.current(message);
    },
  });

  const {
    coopState,
    handleServerMessage,
    sendChat,
    setSharedPlan,
    clearSharedPlan,
  } = useCoopSession({
    wsRef,
    isConnected,
    sessionId,
    vehicleId: requestedRole === 'spectator' ? undefined : vehicleId || undefined,
    userId: user?.id,
    username: user?.username,
    spectator: requestedRole === 'spectator',
  });

  useEffect(() => {
    coopHandlerRef.current = handleServerMessage;
  }, [handleServerMessage]);

  useEffect(() => {
    if (!vehicleId && coopState.vehicles[0]?.vehicleId) {
      setVehicleId(coopState.vehicles[0].vehicleId);
    }
  }, [coopState.vehicles, vehicleId]);

  const inviteUrl =
    typeof window !== 'undefined' && coopState.invitePath
      ? `${window.location.origin}${coopState.invitePath}`
      : '';
  const isCoopHost = Boolean(user?.id && coopState.hostUserId === user.id);
  const hostCanEdit = requestedRole !== 'spectator' && isCoopHost;
  const locationFeed = useVehicleLocationFeed({
    wsUrl: getDefaultLocationWsUrl(),
    vehicleId: vehicleId || 'VH-001',
  });

  const debouncedWaypoints = useDebouncedValue(planningWaypoints, 200);
  const { routingStatus } = useFocusMapRoutingWeather({
    waypoints: debouncedWaypoints,
    pathType: routingMode,
    profile: 'rover',
    speedMps: 2,
    latestLocation: locationFeed.latest,
    onRouteResolved: (route, distance, eta) => {
      setPlanningRoute(route);
      setDistanceMeters(distance);
      setEtaSeconds(eta);
    },
    onRouteFocus: () => {
      setFollowVehicle(false);
      setRouteFocusSignal((prev) => prev + 1);
    },
  });

  useEffect(() => {
    const sharedPlan = coopState.sharedPlan;
    if (!sharedPlan) {
      if (!hostCanEdit) {
        setPlanningWaypoints([]);
        setPlanningRoute(null);
        setDistanceMeters(0);
        setEtaSeconds(0);
      }
      routeVersionRef.current = null;
      return;
    }
    if (routeVersionRef.current === sharedPlan.version) return;
    routeVersionRef.current = sharedPlan.version;
    setPlanningWaypoints(sharedPlan.waypoints);
    setPlanningRoute(sharedPlan.route || null);
    setDistanceMeters(sharedPlan.distanceMeters || 0);
    setEtaSeconds(sharedPlan.etaSeconds || 0);
    lastSharedSignatureRef.current = JSON.stringify({
      waypoints: sharedPlan.waypoints,
      route: sharedPlan.route || null,
      distanceMeters: sharedPlan.distanceMeters || 0,
      etaSeconds: sharedPlan.etaSeconds || 0,
    });
  }, [coopState.sharedPlan, hostCanEdit]);

  useEffect(() => {
    if (!hostCanEdit || !sessionId || !user?.id || !user.username) return;
    if (skipNextShareRef.current) {
      skipNextShareRef.current = false;
      return;
    }
    const hasPlan = planningWaypoints.length > 0 || (planningRoute?.coordinates?.length ?? 0) > 0;
    if (!hasPlan && !coopState.sharedPlan) return;
    const signature = JSON.stringify({
      waypoints: debouncedWaypoints,
      route: planningRoute || null,
      distanceMeters,
      etaSeconds,
    });
    if (signature === lastSharedSignatureRef.current) return;
    lastSharedSignatureRef.current = signature;
    void setSharedPlan({
      waypoints: debouncedWaypoints,
      route: planningRoute,
      distanceMeters,
      etaSeconds,
    });
  }, [
    coopState.sharedPlan,
    debouncedWaypoints,
    distanceMeters,
    etaSeconds,
    hostCanEdit,
    planningRoute,
    planningWaypoints.length,
    sessionId,
    setSharedPlan,
    user?.id,
    user?.username,
  ]);

  const participantByVehicle = useMemo(() => {
    const map = new Map(coopState.participants.map((participant) => [participant.vehicleId, participant]));
    return map;
  }, [coopState.participants]);

  const peerLocations = useMemo(
    () =>
      coopState.vehicles
        .filter((vehicle) => vehicle.vehicleId !== vehicleId)
        .filter((vehicle) => typeof vehicle.lat === 'number' && typeof vehicle.lng === 'number')
        .map((vehicle) => {
          const participant = participantByVehicle.get(vehicle.vehicleId);
          return {
            ts: vehicle.lastUpdatedAt || Date.now(),
            vehicleId: vehicle.vehicleId,
            lat: vehicle.lat || 0,
            lng: vehicle.lng || 0,
            heading: vehicle.heading,
            speedMps: vehicle.speedMps,
            username: participant?.username || vehicle.username,
            role: participant?.role,
            isOnline: participant?.isOnline,
            isActive: participant?.isActive,
            isSpeaking: participant?.isSpeaking,
          };
        }),
    [coopState.vehicles, participantByVehicle, vehicleId]
  );

  const handleCopyInvite = useCallback(async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 1800);
  }, [inviteUrl]);

  const handleManualAdd = useCallback(() => {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setPlanningWaypoints((prev) => [
      ...prev,
      {
        lat: round(lat, 6),
        lng: round(lng, 6),
        label: `WP ${prev.length + 1}`,
      },
    ]);
    setManualLat('');
    setManualLng('');
    setRouteFocusSignal((prev) => prev + 1);
  }, [manualLat, manualLng]);

  const clearPlan = useCallback(() => {
    setPlanningWaypoints([]);
    setPlanningRoute(null);
    setDistanceMeters(0);
    setEtaSeconds(0);
    if (hostCanEdit) {
      skipNextShareRef.current = true;
      void clearSharedPlan();
    }
  }, [clearSharedPlan, hostCanEdit]);

  return (
    <main className="container mx-auto max-w-[1500px] px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Coop Session</div>
          <h1 className="text-2xl font-bold tracking-tight">{sessionId}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/coop')}>
            Back
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleCopyInvite()}>
            <Copy className="mr-2 size-3.5" />
            {inviteCopied ? 'Copied' : 'Copy Invite'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/control?vehicleId=${encodeURIComponent(vehicleId || 'VH-001')}`)}>
            Control
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="border-border/70 bg-card/90">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span className="flex items-center gap-2">
                <MapPinned className="size-4" />
                Shared Map
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {hostCanEdit ? 'Host editing enabled' : requestedRole === 'spectator' ? 'Spectating' : 'Read only'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setFollowVehicle(true)}>
                <Eye className="mr-2 size-3.5" />
                Follow
              </Button>
              <Button size="sm" variant="outline" onClick={clearPlan} disabled={!hostCanEdit && !coopState.sharedPlan}>
                <Trash2 className="mr-2 size-3.5" />
                Clear
              </Button>
              <div className="ml-auto text-xs text-muted-foreground">
                {routingStatus || `${planningWaypoints.length} waypoints`}
              </div>
            </div>

            {hostCanEdit && (
              <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 md:grid-cols-[1fr_1fr_auto]">
                <Input value={manualLat} onChange={(event) => setManualLat(event.target.value)} placeholder="Latitude" />
                <Input value={manualLng} onChange={(event) => setManualLng(event.target.value)} placeholder="Longitude" />
                <Button onClick={handleManualAdd}>
                  <Plus className="mr-2 size-3.5" />
                  Add
                </Button>
              </div>
            )}

            <div className="relative h-[calc(100vh-16rem)] min-h-[28rem]">
              <Suspense fallback={<ControllerPanelFallback title="Map" />}>
                <MapPanel
                  location={locationFeed.latest}
                  peerLocations={peerLocations}
                  isConnected={locationFeed.isConnected}
                  error={locationFeed.error}
                  route={planningRoute}
                  sharedPlan={coopState.sharedPlan}
                  waypoints={planningWaypoints}
                  showWaypoints
                  followHeading
                  followLocation={followVehicle}
                  autoFitRouteSignal={routeFocusSignal}
                  onMapClick={
                    hostCanEdit
                      ? (lng, lat) =>
                          setPlanningWaypoints((prev) => [
                            ...prev,
                            { lng: round(lng, 6), lat: round(lat, 6), label: `WP ${prev.length + 1}` },
                          ])
                      : undefined
                  }
                  onMapRightClick={
                    hostCanEdit
                      ? () =>
                          setPlanningWaypoints((prev) => {
                            const next = [...prev];
                            next.pop();
                            return next;
                          })
                      : undefined
                  }
                  onWaypointDrag={
                    hostCanEdit
                      ? (index, lng, lat) =>
                          setPlanningWaypoints((prev) => {
                            const next = [...prev];
                            if (!next[index]) return prev;
                            next[index] = { ...next[index], lng: round(lng, 6), lat: round(lat, 6) };
                            return next;
                          })
                      : undefined
                  }
                  onWaypointClick={
                    hostCanEdit
                      ? (index) =>
                          setPlanningWaypoints((prev) => {
                            const next = [...prev];
                            next.splice(index, 1);
                            return next;
                          })
                      : undefined
                  }
                  draggableWaypoints={hostCanEdit}
                  mapOverlay={
                    <div className="absolute left-3 top-3 z-40">
                      <CoopLegend
                        participants={coopState.participants}
                        vehicles={coopState.vehicles}
                        open={legendOpen}
                        onToggle={() => setLegendOpen((prev) => !prev)}
                        className="w-72"
                      />
                    </div>
                  }
                />
              </Suspense>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="border-border/70 bg-card/90">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4" />
                Session State
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Role</span>
                <span>{hostCanEdit ? 'Host' : requestedRole === 'spectator' ? 'Spectator' : 'Participant'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Vehicle</span>
                <span>{vehicleId || 'Unassigned'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Distance</span>
                <span>{distanceMeters ? `${distanceMeters.toFixed(0)} m` : '--'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">ETA</span>
                <span>{etaSeconds ? `${Math.round(etaSeconds)} s` : '--'}</span>
              </div>
            </CardContent>
          </Card>

          <ControllerChatPanel
            sessionId={sessionId}
            inviteUrl={inviteUrl}
            inviteCopied={inviteCopied}
            isCoopHost={isCoopHost}
            participants={coopState.participants}
            messages={coopState.messages}
            terminalOutput={[]}
            sharedPlan={coopState.sharedPlan}
            selectedRouteReady={hostCanEdit && planningWaypoints.length > 0}
            currentUserId={user?.id}
            className="min-h-[24rem]"
            onSendChat={sendChat}
            onStartSession={() => {}}
            onCopyInvite={handleCopyInvite}
            onShareRoute={() =>
              void setSharedPlan({
                waypoints: planningWaypoints,
                route: planningRoute,
                distanceMeters,
                etaSeconds,
              })
            }
            onClearRoute={clearPlan}
          />
        </div>
      </div>
    </main>
  );
}
