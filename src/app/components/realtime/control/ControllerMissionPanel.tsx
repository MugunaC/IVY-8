import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/app/components/ui/select';
import { Button } from '@/app/components/ui/button';
import { formatMissionSummary } from '@/app/components/realtime/missionUtils';
import type { MissionPlan } from '@shared/types';

interface ControllerMissionPanelProps {
  driveMode: 'manual' | 'auto';
  activeMissionId: string | null;
  draftMission: MissionPlan | null;
  missions: MissionPlan[];
  selectedMissionId: string | null;
  mapRegionLabel: string;
  vehicleId?: string;
  resolveSelectedMission: () => MissionPlan | null;
  onSelectMission: (value: string) => void;
  onRefreshMissions: () => void;
  onRequestAutoMode: () => void;
  onCancelMissionPrompt: () => void;
  onStopVehicle: () => void;
  onRetraceMission: () => void;
}

export function ControllerMissionPanel(props: ControllerMissionPanelProps) {
  const {
    driveMode,
    activeMissionId,
    draftMission,
    missions,
    selectedMissionId,
    mapRegionLabel,
    vehicleId,
    resolveSelectedMission,
    onSelectMission,
    onRefreshMissions,
    onRequestAutoMode,
    onCancelMissionPrompt,
    onStopVehicle,
    onRetraceMission,
  } = props;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Autonomy</div>
          <div className="text-xs text-muted-foreground">
            Mode: {driveMode.toUpperCase()}
            {activeMissionId
              ? ` • Active mission: ${formatMissionSummary(
                  (draftMission && activeMissionId === draftMission.id
                    ? draftMission
                    : missions.find((m) => m.id === activeMissionId)) || null,
                  mapRegionLabel
                )}`
              : ''}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={driveMode === 'auto' ? 'default' : 'outline'} onClick={driveMode === 'auto' ? onCancelMissionPrompt : onRequestAutoMode}>
            {driveMode === 'auto' ? 'Exit Auto' : 'Enable Auto'}
          </Button>
          <Button size="sm" variant="outline" onClick={onRefreshMissions}>
            Refresh
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        <label className="text-xs uppercase text-muted-foreground">Mission</label>
        <Select value={selectedMissionId ?? ''} onValueChange={onSelectMission}>
          <SelectTrigger>
            <SelectValue placeholder="Select mission" />
          </SelectTrigger>
          <SelectContent>
            {missions
              .filter((entry) => !vehicleId || entry.vehicleId === vehicleId)
              .map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">{formatMissionSummary(resolveSelectedMission(), mapRegionLabel)}</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onStopVehicle}>
            Stop Vehicle
          </Button>
          <Button size="sm" variant="outline" onClick={onRetraceMission}>
            Retrace Steps
          </Button>
          <Button size="sm" variant="outline" onClick={onRequestAutoMode}>
            Send New Mission
          </Button>
        </div>
      </div>
    </div>
  );
}
