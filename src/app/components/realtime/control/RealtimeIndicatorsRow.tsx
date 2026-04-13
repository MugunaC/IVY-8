import type { ReactNode } from 'react';
import { Bot, Car, Gamepad2 } from 'lucide-react';

type RealtimeIndicatorsRowProps = {
  deviceOnline: boolean;
  gamepadConnected: boolean;
  driveMode: 'manual' | 'auto';
  onDeviceClick: () => void;
  onControllerClick: () => void;
  onAutoClick: () => void;
  compact?: boolean;
  labels?: boolean;
};

function IndicatorButton({
  title,
  onClick,
  label,
  children,
  compact = false,
}: {
  title: string;
  onClick: () => void;
  label?: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center gap-2 rounded-full border border-border/70 bg-card transition hover:border-border hover:bg-card/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
        compact ? 'px-2 py-1' : 'px-2.5 py-1'
      }`}
    >
      {children}
      {label ? <span className="text-[11px] font-medium text-foreground">{label}</span> : null}
    </button>
  );
}

export function RealtimeIndicatorsRow(props: RealtimeIndicatorsRowProps) {
  const {
    deviceOnline,
    gamepadConnected,
    driveMode,
    onDeviceClick,
    onControllerClick,
    onAutoClick,
    compact = false,
    labels = false,
  } = props;

  return (
    <div className={`flex items-center gap-2 text-xs text-muted-foreground ${compact ? 'flex-nowrap' : 'flex-wrap'}`}>
      <IndicatorButton title="Device status" onClick={onDeviceClick} label={labels ? 'Device' : undefined} compact={compact}>
        <Car
          className={`size-4 ${
            deviceOnline ? 'text-emerald-500 drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'text-slate-400'
          }`}
        />
      </IndicatorButton>
      <IndicatorButton
        title="Controller status"
        onClick={onControllerClick}
        label={labels ? 'Ctrl' : undefined}
        compact={compact}
      >
        <Gamepad2
          className={`size-4 ${
            gamepadConnected
              ? 'text-emerald-500 drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]'
              : 'text-slate-400'
          }`}
        />
      </IndicatorButton>
      <IndicatorButton
        title={driveMode === 'auto' ? 'Auto mode active' : 'Manual mode'}
        onClick={onAutoClick}
        label={labels ? (driveMode === 'auto' ? 'Auto' : 'Manual') : undefined}
        compact={compact}
      >
        <Bot
          className={`size-4 ${
            driveMode === 'auto'
              ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.75)]'
              : 'text-slate-400'
          }`}
          aria-hidden="true"
        />
      </IndicatorButton>
    </div>
  );
}
