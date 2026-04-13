import { Input } from '@/app/components/ui/input';
import { Button } from '@/app/components/ui/button';

interface ControllerTransportSettingsProps {
  wsUrl: string;
  wsUrlInput: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
}

export function ControllerTransportSettings(props: ControllerTransportSettingsProps) {
  const { wsUrl, wsUrlInput, onChange, onSave, onReset } = props;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">WebSocket URL</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={wsUrlInput}
          onChange={(event) => onChange(event.target.value)}
          placeholder="wss://random.trycloudflare.com"
          className="sm:flex-1"
          aria-label="WebSocket URL"
        />
        <div className="flex gap-2">
          <Button onClick={onSave}>Apply</Button>
          <Button onClick={onReset} variant="outline">
            Reset
          </Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">Active URL: {wsUrl}</div>
    </div>
  );
}
