import { Flag, Layers, Route, Search } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { LocationIcon } from '@/app/components/realtime/LocationIcon';
import { RealtimeIndicatorsRow } from '@/app/components/realtime/control/RealtimeIndicatorsRow';

type FocusMapFloatingControlsProps = {
  deviceOnline: boolean;
  gamepadConnected: boolean;
  driveMode: 'manual' | 'auto';
  onDeviceClick: () => void;
  onControllerClick: () => void;
  onAutoClick: () => void;
  onFollow: () => void;
  onThemes: () => void;
  onMissionPlanner: () => void;
  onSearch: () => void;
  onShareRoute?: () => void;
  canShareRoute?: boolean;
};

export function FocusMapFloatingControls(props: FocusMapFloatingControlsProps) {
  const {
    deviceOnline,
    gamepadConnected,
    driveMode,
    onDeviceClick,
    onControllerClick,
    onAutoClick,
    onFollow,
    onThemes,
    onMissionPlanner,
    onSearch,
    onShareRoute,
    canShareRoute = false,
  } = props;

  return (
    <div className="pointer-events-none fixed bottom-16 left-1/2 z-40 flex -translate-x-1/2 md:absolute md:bottom-5 md:left-5 md:translate-x-0">
      <div className="pointer-events-auto flex max-w-[95vw] items-center gap-3 rounded-full border border-border/[0.06] bg-card/35 px-3 py-2 shadow-lg backdrop-blur-lg">
        <RealtimeIndicatorsRow
          deviceOnline={deviceOnline}
          gamepadConnected={gamepadConnected}
          driveMode={driveMode}
          onDeviceClick={onDeviceClick}
          onControllerClick={onControllerClick}
          onAutoClick={onAutoClick}
          compact
        />
        <div className="h-5 w-px bg-border/70" />
        <Button size="sm" variant="outline" className="bg-card/90 backdrop-blur" onClick={onFollow} title="Follow vehicle">
          <LocationIcon className="size-4" />
        </Button>
        <Button size="sm" variant="outline" className="bg-card/90 backdrop-blur" onClick={onThemes} title="Map themes">
          <Layers className="size-4" />
        </Button>
        <Button size="sm" variant="outline" className="bg-card/90 backdrop-blur" onClick={onMissionPlanner} title="Mission planner">
          <Flag className="size-4" />
        </Button>
        {onShareRoute && (
          <Button
            size="sm"
            variant="outline"
            className="bg-card/90 backdrop-blur"
            onClick={onShareRoute}
            title="Share route"
            disabled={!canShareRoute}
          >
            <Route className="size-4" />
          </Button>
        )}
        <Button size="sm" variant="outline" className="bg-card/90 backdrop-blur" onClick={onSearch} title="Search location">
          <Search className="size-4" />
        </Button>
      </div>
    </div>
  );
}
