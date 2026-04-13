import type { CoopParticipant, CoopSessionVehicle } from '@shared/types';
import { Badge } from '@/app/components/ui/badge';
import { cn } from '@/app/components/ui/utils';
import { ChevronDown, ChevronUp, Mic, Radio, UserRound } from 'lucide-react';
import { getVehicleColor } from './vehicleColors';

type CoopLegendProps = {
  participants: CoopParticipant[];
  vehicles: CoopSessionVehicle[];
  open: boolean;
  onToggle: () => void;
  className?: string;
};

function sortParticipants(participants: CoopParticipant[]) {
  const roleWeight: Record<CoopParticipant['role'], number> = {
    host: 0,
    driver: 1,
    spectator: 2,
  };
  return [...participants].sort((a, b) => {
    const roleDiff = roleWeight[a.role] - roleWeight[b.role];
    if (roleDiff !== 0) return roleDiff;
    return a.joinedAt - b.joinedAt;
  });
}

export function CoopLegend(props: CoopLegendProps) {
  const { participants, vehicles, open, onToggle, className } = props;
  const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.vehicleId, vehicle]));
  const ordered = sortParticipants(participants);

  return (
    <section
      className={cn(
        'pointer-events-auto rounded-xl border border-white/10 bg-slate-950/88 text-slate-100 shadow-2xl backdrop-blur',
        className
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-300">
          <UserRound className="size-3.5" />
          Legend
          <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-slate-200">
            {participants.length}
          </Badge>
        </div>
        <span className="flex h-7 w-7 items-center justify-center rounded-md text-slate-200">
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      </button>
      {open && (
        <div className="grid max-h-64 gap-2 overflow-y-auto border-t border-white/10 px-3 py-3">
          {ordered.map((participant) => {
            const vehicle = participant.vehicleId ? vehiclesById.get(participant.vehicleId) : undefined;
            const color = getVehicleColor(participant.vehicleId);
            return (
              <article
                key={participant.userId}
                className="grid gap-1 rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-3 rounded-full border"
                      style={{
                        backgroundColor: participant.vehicleId ? color.fill : '#94a3b8',
                        borderColor: participant.vehicleId ? color.border : '#475569',
                        boxShadow: `0 0 0 2px ${participant.vehicleId ? color.glow : 'rgba(148,163,184,0.2)'}`,
                      }}
                    />
                    <span className="truncate font-semibold text-slate-50">{participant.username}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-300">
                    {participant.isSpeaking ? <Mic className="size-3 text-emerald-300" /> : null}
                    {participant.isActive ? <Radio className="size-3 text-sky-300" /> : null}
                    <span>{participant.isOnline ? 'Online' : 'Offline'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-300">
                  <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] capitalize text-slate-200">
                    {participant.role}
                  </Badge>
                  <span className="truncate">
                    {vehicle?.vehicleId || participant.vehicleId || 'No vehicle assigned'}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
