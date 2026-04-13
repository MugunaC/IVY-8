import type { ComponentProps } from 'react';
import { ChevronDown, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { OverlayModal } from '@/app/components/ui/overlay-modal';
import { MissionPlannerTabs } from '@/app/components/realtime/MissionPlannerTabs';

type FocusMapMissionOverlayProps = {
  open: boolean;
  onClose: () => void;
  missionWaypointsCount: number;
  missionDistanceLabel: string;
  missionEtaLabel: string;
  planningEnabled: boolean;
  showMissionPlanner: boolean;
  plannerMounted: boolean;
  missionPathType: string;
  missionProfile: string;
  routingStatus: string | null;
  lastSearchCoords: { lat: number; lng: number } | null;
  onTogglePlanning: () => void;
  onTogglePlanner: () => void;
  onAddLastSearch: () => void;
  onUndoWaypoint: () => void;
  onClearWaypoints: () => void;
  plannerProps: ComponentProps<typeof MissionPlannerTabs>;
};

export function FocusMapMissionOverlay(props: FocusMapMissionOverlayProps) {
  const {
    open,
    onClose,
    missionWaypointsCount,
    missionDistanceLabel,
    missionEtaLabel,
    planningEnabled,
    showMissionPlanner,
    plannerMounted,
    missionPathType,
    missionProfile,
    routingStatus,
    lastSearchCoords,
    onTogglePlanning,
    onTogglePlanner,
    onAddLastSearch,
    onUndoWaypoint,
    onClearWaypoints,
    plannerProps,
  } = props;

  return (
    <OverlayModal open={open} title="Mission" onClose={onClose} maxWidthClassName="max-w-4xl">
      <div className="grid gap-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {missionWaypointsCount} waypoints • {missionDistanceLabel} • {missionEtaLabel}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={planningEnabled ? 'default' : 'outline'} onClick={onTogglePlanning}>
              {planningEnabled ? 'Planning on' : 'Planning off'}
            </Button>
            <Button size="sm" variant="outline" onClick={onTogglePlanner}>
              <ChevronDown className="mr-2 size-4" />
              {showMissionPlanner ? 'Hide planner' : 'Show planner'}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 rounded-lg border border-border/70 bg-muted/20 p-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onAddLastSearch}
            disabled={!lastSearchCoords}
            title={lastSearchCoords ? 'Add last search location as waypoint' : 'Search first to add'}
          >
            <Plus className="mr-2 size-4" />
            Add last search
          </Button>
          <Button size="sm" variant="outline" onClick={onUndoWaypoint} disabled={!missionWaypointsCount}>
            <RotateCcw className="mr-2 size-4" />
            Undo
          </Button>
          <Button size="sm" variant="outline" onClick={onClearWaypoints} disabled={!missionWaypointsCount}>
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
        {plannerMounted && <div className={showMissionPlanner ? 'block' : 'hidden'}><MissionPlannerTabs {...plannerProps} /></div>}
      </div>
    </OverlayModal>
  );
}
