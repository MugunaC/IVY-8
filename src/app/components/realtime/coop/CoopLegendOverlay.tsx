import type { CoopParticipant, CoopSessionVehicle } from '@shared/types';
import { Button } from '@/app/components/ui/button';
import { Maximize2, Minimize2, SlidersHorizontal, X } from 'lucide-react';
import { CoopLegend } from './CoopLegend';

type CoopLegendOverlayProps = {
  participants: CoopParticipant[];
  vehicles: CoopSessionVehicle[];
  minimized: boolean;
  opacity: number;
  onToggleOpacity: () => void;
  onToggleMinimized: () => void;
  onClose: () => void;
};

export function CoopLegendOverlay(props: CoopLegendOverlayProps) {
  const {
    participants,
    vehicles,
    minimized,
    opacity,
    onToggleOpacity,
    onToggleMinimized,
    onClose,
  } = props;

  if (!participants.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-24 z-40 md:top-6">
      <section
        className="pointer-events-auto w-[19rem] rounded-xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur"
        style={{ opacity }}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="text-xs font-semibold">Coop Legend</div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={onToggleOpacity} title="Transparency">
              <SlidersHorizontal className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onToggleMinimized}
              title={minimized ? 'Expand' : 'Minimize'}
            >
              {minimized ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}
            </Button>
            <Button size="icon" variant="ghost" onClick={onClose} title="Dismiss">
              <X className="size-4" />
            </Button>
          </div>
        </div>
        {!minimized && (
          <CoopLegend
            participants={participants}
            vehicles={vehicles}
            hideHeader
            className="max-h-[22rem] overflow-hidden rounded-t-none border-0 bg-transparent shadow-none"
          />
        )}
      </section>
    </div>
  );
}
