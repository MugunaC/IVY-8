import type { MissionPathType, MissionPlan, MissionWaypoint } from '@shared/types';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';

type OsrmStep = {
  name?: string;
  distance?: number;
  duration?: number;
  maneuver?: { type?: string; modifier?: string; exit?: number };
};

type RouteAlternative = {
  coordinates: [number, number][];
  distance: number;
  duration: number;
  steps: OsrmStep[];
};

interface MissionPlannerTabsProps {
  planningEnabled: boolean;
  setPlanningEnabled: (value: boolean) => void;
  missionPathType: MissionPathType;
  setMissionPathType: (value: MissionPathType) => void;
  routingStatus: string | null;
  missionProfile: 'rover' | 'drone';
  setMissionProfile: (value: 'rover' | 'drone') => void;
  missionSpeedMps: number;
  setMissionSpeedMps: (value: number) => void;
  missionWaypoints: MissionWaypoint[];
  handleUndoWaypoint: () => void;
  handleClearWaypoints: () => void;
  manualLat: string;
  setManualLat: (value: string) => void;
  manualLng: string;
  setManualLng: (value: string) => void;
  handleManualAdd: () => void;
  arrivalRadiusM: number;
  setArrivalRadiusM: (value: number) => void;
  loiterSeconds: number;
  setLoiterSeconds: (value: number) => void;
  cruiseAltitudeM: number;
  setCruiseAltitudeM: (value: number) => void;
  missionDistanceLabel: string;
  missionEtaLabel: string;
  routeAlternatives: RouteAlternative[];
  selectedRouteIndex: number;
  handleSelectRoute: (index: number) => void;
  setHoveredRouteIndex: (index: number | null) => void;
  routeSteps: OsrmStep[];
  instructionLocale: 'en' | 'sw';
  formatMeters: (value: number) => string;
  formatEta: (value: number) => string;
  formatStepInstruction: (step: OsrmStep, locale: 'en' | 'sw') => string;
  missionName: string;
  setMissionName: (value: string) => void;
  handleSaveMission: () => void;
  missionCanSave: boolean;
  missionSaveStatus: string | null;
  selectedMissionId: string | null;
  setSelectedMissionId: (value: string | null) => void;
  missions: MissionPlan[];
  vehicleId: string;
  handleDeleteMission: () => void;
}

export function MissionPlannerTabs(props: MissionPlannerTabsProps) {
  const {
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
  } = props;

  return (
    <div className="mt-3 text-xs">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold">Mission planner</span>
        <Button
          size="sm"
          variant={planningEnabled ? 'default' : 'outline'}
          onClick={() => setPlanningEnabled(!planningEnabled)}
        >
          {planningEnabled ? 'Planning on' : 'Planning off'}
        </Button>
      </div>
      <Tabs defaultValue="plan" className="mt-3 text-xs">
        <TabsList className="w-full">
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="params">Params</TabsTrigger>
          <TabsTrigger value="route">Route</TabsTrigger>
          <TabsTrigger value="save">Save</TabsTrigger>
        </TabsList>
        <TabsContent value="plan" className="mt-3 grid gap-3">
          <div className="grid gap-2">
            <label className="text-[11px] uppercase text-muted-foreground">Path type</label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant={missionPathType === 'straight' ? 'default' : 'outline'}
                onClick={() => setMissionPathType('straight')}
              >
                Straight
              </Button>
              <Button
                size="sm"
                variant={missionPathType === 'roads' ? 'default' : 'outline'}
                onClick={() => setMissionPathType('roads')}
              >
                Roads
              </Button>
            </div>
            {routingStatus && <p className="text-[11px] text-muted-foreground">{routingStatus}</p>}
          </div>
          <div className="grid gap-2">
            <label className="text-[11px] uppercase text-muted-foreground">Mission profile</label>
            <Select
              value={missionProfile}
              onValueChange={(value) => setMissionProfile(value === 'drone' ? 'drone' : 'rover')}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select profile" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rover">Rover (roads)</SelectItem>
                <SelectItem value="drone">Drone (straight)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Rover missions prefer OSRM roads. Drone missions use straight-line legs.
            </p>
          </div>
          <div className="grid gap-2">
            <label className="text-[11px] uppercase text-muted-foreground">Cruise speed (m/s)</label>
            <Input
              type="number"
              min={0.1}
              step={0.1}
              value={Number.isFinite(missionSpeedMps) ? missionSpeedMps : 1}
              onChange={(event) => setMissionSpeedMps(Number(event.target.value))}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-[11px] uppercase text-muted-foreground">Waypoints</label>
            <div className="flex items-center justify-between">
              <span>{missionWaypoints.length} points</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleUndoWaypoint}
                  disabled={!missionWaypoints.length}
                >
                  Undo
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleClearWaypoints}
                  disabled={!missionWaypoints.length}
                >
                  Clear
                </Button>
              </div>
            </div>
            {planningEnabled ? (
              <p className="text-[11px] text-muted-foreground">
                Left click adds, click a waypoint to remove, drag to move, right click removes the nearest point.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">Enable planning to add waypoints.</p>
            )}
          </div>
          <div className="grid gap-2">
            <label className="text-[11px] uppercase text-muted-foreground">Manual waypoint</label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Latitude"
                value={manualLat}
                onChange={(event) => setManualLat(event.target.value)}
              />
              <Input
                placeholder="Longitude"
                value={manualLng}
                onChange={(event) => setManualLng(event.target.value)}
              />
            </div>
            <Button size="sm" variant="outline" onClick={handleManualAdd}>
              Add point
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="params" className="mt-3 grid gap-3">
          <div className="grid gap-2">
            <label className="text-[11px] uppercase text-muted-foreground">Autonomy params</label>
            <div className="grid grid-cols-3 gap-2">
              <Input
                type="number"
                min={0.5}
                step={0.5}
                value={arrivalRadiusM}
                onChange={(event) => setArrivalRadiusM(Number(event.target.value))}
                aria-label="Arrival radius (meters)"
                placeholder="Arrival radius (m)"
              />
              <Input
                type="number"
                min={0}
                step={1}
                value={loiterSeconds}
                onChange={(event) => setLoiterSeconds(Number(event.target.value))}
                aria-label="Loiter time (seconds)"
                placeholder="Loiter time (s)"
              />
              <Input
                type="number"
                min={0}
                step={1}
                value={cruiseAltitudeM}
                onChange={(event) => setCruiseAltitudeM(Number(event.target.value))}
                aria-label="Cruise altitude (meters)"
                placeholder="Cruise altitude (m)"
                disabled={missionProfile !== 'drone'}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <span>Arrival radius</span>
              <span>Loiter time</span>
              <span>Cruise altitude</span>
            </div>
          </div>
          <div className="grid gap-2">
            <label className="text-[11px] uppercase text-muted-foreground">Distance / ETA</label>
            <div className="flex items-center justify-between">
              <span>{missionDistanceLabel}</span>
              <span>{missionEtaLabel}</span>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="route" className="mt-3 grid gap-3">
          <div className="grid gap-2">
            <label className="text-[11px] uppercase text-muted-foreground">Route options</label>
            {routeAlternatives.length > 1 ? (
              <div className="grid gap-2">
                {routeAlternatives.map((route, index) => (
                  <Button
                    key={`route-${index}`}
                    size="sm"
                    variant={selectedRouteIndex === index ? 'default' : 'outline'}
                    onClick={() => handleSelectRoute(index)}
                    className="justify-between"
                    onMouseEnter={() => setHoveredRouteIndex(index)}
                    onMouseLeave={() => setHoveredRouteIndex(null)}
                  >
                    <span>Route {index + 1}</span>
                    <span>
                      {formatMeters(route.distance)} • {formatEta(route.duration)}
                    </span>
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {routeAlternatives.length === 1
                  ? 'Single route returned.'
                  : 'No route alternatives yet.'}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <label className="text-[11px] uppercase text-muted-foreground">Turn-by-turn</label>
            {routeSteps.length ? (
              <div className="max-h-56 overflow-y-auto rounded-md border border-border/70 p-2">
                <ol className="space-y-2 text-xs">
                  {routeSteps.map((step, index) => (
                    <li key={`step-${index}`} className="flex items-center justify-between gap-3">
                      <span>{formatStepInstruction(step, instructionLocale)}</span>
                      <span className="text-muted-foreground">
                        {formatMeters(step.distance ?? 0)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {routingStatus || 'No steps available.'}
              </p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="save" className="mt-3 grid gap-3">
          <div className="grid gap-2">
            <label className="text-[11px] uppercase text-muted-foreground">Mission name</label>
            <Input value={missionName} onChange={(event) => setMissionName(event.target.value)} />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void handleSaveMission()} disabled={!missionCanSave}>
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedMissionId(null)}>
                New
              </Button>
            </div>
            {missionSaveStatus && (
              <p className="text-[11px] text-muted-foreground">{missionSaveStatus}</p>
            )}
          </div>
          <div className="grid gap-2">
            <label className="text-[11px] uppercase text-muted-foreground">Saved missions</label>
            <Select
              value={selectedMissionId ?? ''}
              onValueChange={(value) => setSelectedMissionId(value || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select mission" />
              </SelectTrigger>
              <SelectContent>
                {missions
                  .filter((entry) => entry.vehicleId === vehicleId)
                  .map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleDeleteMission}
                disabled={!selectedMissionId}
              >
                Delete
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
