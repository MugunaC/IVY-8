import { Button } from '@/app/components/ui/button';

interface ControllerDiagnosticsPanelProps {
  batteryLabel: string;
  hidSupported: boolean;
  hidSecure: boolean;
  canUseHid: boolean;
  hidDeviceConnected: boolean;
  hidProfile: string | null;
  lightbarColor: string;
  onSetLightbarColor: (value: string) => void;
  onConnectHid: () => void;
  onDisconnectHid: () => void;
  onApplyLightbar: () => void;
}

export function ControllerDiagnosticsPanel(props: ControllerDiagnosticsPanelProps) {
  const {
    batteryLabel,
    hidSupported,
    hidSecure,
    canUseHid,
    hidDeviceConnected,
    hidProfile,
    lightbarColor,
    onSetLightbarColor,
    onConnectHid,
    onDisconnectHid,
    onApplyLightbar,
  } = props;

  return (
    <>
      <div className="text-sm text-muted-foreground">Controller battery: {batteryLabel}</div>
      <div className="space-y-2 rounded-lg border border-border p-3">
        <div className="text-sm font-medium">Controller Lightbar (WebHID)</div>
        {!hidSupported && <div className="text-xs text-muted-foreground">WebHID is not supported in this browser.</div>}
        {hidSupported && !hidSecure && <div className="text-xs text-muted-foreground">WebHID requires HTTPS or localhost.</div>}
        {canUseHid && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={hidDeviceConnected ? onDisconnectHid : onConnectHid} variant="outline">
                {hidDeviceConnected ? 'Disconnect' : 'Connect'}
              </Button>
              <input
                type="color"
                value={lightbarColor}
                onChange={(event) => onSetLightbarColor(event.target.value)}
                className="h-8 w-10 rounded border border-border bg-transparent p-0"
                aria-label="Lightbar color"
              />
              <Button onClick={onApplyLightbar} variant="outline" disabled={!hidDeviceConnected}>
                Apply
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">USB connection required. Detected profile: {hidProfile || 'none'}</div>
          </>
        )}
      </div>
    </>
  );
}
