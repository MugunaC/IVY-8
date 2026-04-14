import type { CoopParticipant, CoopSharedPlan } from '@shared/types';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { OverlayModal } from '@/app/components/ui/overlay-modal';
import { Copy, Trash2 } from 'lucide-react';

type CoopSessionControlOverlayProps = {
  open: boolean;
  sessionId: string;
  joinSessionDraft: string;
  coopVehicleId?: string;
  inviteUrl: string;
  inviteCopied: boolean;
  participants: CoopParticipant[];
  isCoopHost: boolean;
  sharedPlan?: CoopSharedPlan | null;
  onClose: () => void;
  onJoinSessionDraftChange: (value: string) => void;
  onHostSession: () => void;
  onJoinSession: (sessionId: string, asSpectator: boolean) => void;
  onLeaveSession: () => void;
  onCopyInvite: () => Promise<void> | void;
  onClearRoute: () => void;
};

export function CoopSessionControlOverlay(props: CoopSessionControlOverlayProps) {
  const {
    open,
    sessionId,
    joinSessionDraft,
    coopVehicleId,
    inviteUrl,
    inviteCopied,
    participants,
    isCoopHost,
    sharedPlan,
    onClose,
    onJoinSessionDraftChange,
    onHostSession,
    onJoinSession,
    onLeaveSession,
    onCopyInvite,
    onClearRoute,
  } = props;

  return (
    <OverlayModal open={open} title="Coop" onClose={onClose} maxWidthClassName="max-w-lg">
      <div className="grid gap-3 text-sm">
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Vehicle: {coopVehicleId || 'none'}
        </div>

        <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Session</div>
          <Input
            value={joinSessionDraft}
            onChange={(event) => onJoinSessionDraftChange(event.target.value)}
            placeholder="Session code"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                onHostSession();
                onClose();
              }}
            >
              Host
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!joinSessionDraft.trim()}
              onClick={() => {
                onJoinSession(joinSessionDraft.trim(), false);
                onClose();
              }}
            >
              Join
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!joinSessionDraft.trim()}
              onClick={() => {
                onJoinSession(joinSessionDraft.trim(), true);
                onClose();
              }}
            >
              Spectate
            </Button>
            {sessionId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onLeaveSession();
                  onClose();
                }}
              >
                Leave
              </Button>
            )}
          </div>
        </div>

        <div className="truncate rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {inviteUrl || 'Invite unavailable'}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void onCopyInvite()} disabled={!inviteUrl}>
            <Copy className="mr-2 size-3.5" />
            {inviteCopied ? 'Copied' : 'Copy Invite'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClearRoute} disabled={!sharedPlan || !isCoopHost}>
            <Trash2 className="mr-2 size-3.5" />
            Clear Plan
          </Button>
        </div>

        <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Participants
          </div>
          {participants.length === 0 ? (
            <div className="text-sm text-muted-foreground">No participants connected.</div>
          ) : (
            participants.map((participant) => (
              <div
                key={participant.userId}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{participant.username}</div>
                  <div className="text-xs text-muted-foreground">
                    {participant.role} · {participant.vehicleId || 'no vehicle'}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {participant.isOnline === false
                    ? 'offline'
                    : participant.isSpeaking
                      ? 'speaking'
                      : participant.isActive
                        ? 'active'
                        : 'idle'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </OverlayModal>
  );
}
