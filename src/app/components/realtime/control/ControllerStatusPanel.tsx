import { Wifi, WifiOff, Bot } from 'lucide-react';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';

interface ControllerStatusPanelProps {
  connected: boolean;
  driveMode: 'manual' | 'auto';
  pauseLatched: boolean;
  estopLatched: boolean;
  inputPaused?: boolean;
  serverTelemetryAck: { received: number; lastAckTs: number | null };
  hapticsSupported: boolean | null;
  onTogglePause: () => void;
  onClearEstop: () => void;
  onTriggerHaptics: () => void;
}

export function ControllerStatusPanel(props: ControllerStatusPanelProps) {
  const {
    connected,
    driveMode,
    pauseLatched,
    estopLatched,
    inputPaused = false,
    serverTelemetryAck,
    hapticsSupported,
    onTogglePause,
    onClearEstop,
    onTriggerHaptics,
  } = props;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {connected ? (
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
          Last ack: {serverTelemetryAck.lastAckTs ? new Date(serverTelemetryAck.lastAckTs).toLocaleTimeString() : '-'}
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
          {estopLatched ? 'Emergency stop latched' : pauseLatched ? 'Input paused' : 'Ready to control vehicle'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onTogglePause} variant={(pauseLatched || estopLatched) ? 'default' : 'outline'} disabled={estopLatched}>
          {(pauseLatched || estopLatched) ? 'Resume Input' : 'Pause Input'}
        </Button>
        <Button onClick={onClearEstop} variant="destructive" disabled={!estopLatched}>
          Clear E-Stop
        </Button>
        <Button onClick={onTriggerHaptics} variant="outline" disabled={hapticsSupported === false}>
          Test Haptics
        </Button>
      </div>
    </div>
  );
}
