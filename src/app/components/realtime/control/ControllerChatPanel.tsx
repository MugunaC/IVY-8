import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoopChatMessage, CoopParticipant, CoopSharedPlan } from '@shared/types';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { OverlayModal } from '@/app/components/ui/overlay-modal';
import { cn } from '@/app/components/ui/utils';
import {
  Copy,
  List,
  MessageSquare,
  Minimize2,
  Play,
  Route,
  Send,
  Trash2,
  Users,
} from 'lucide-react';

type ControllerChatPanelProps = {
  sessionId: string;
  inviteUrl: string;
  inviteCopied: boolean;
  isCoopHost: boolean;
  participants: CoopParticipant[];
  messages: CoopChatMessage[];
  terminalOutput: string[];
  sharedPlan?: CoopSharedPlan | null;
  selectedRouteReady: boolean;
  currentUserId?: string;
  className?: string;
  onHide?: () => void;
  onSendChat: (text: string) => void;
  onStartSession: () => void;
  onCopyInvite: () => Promise<void> | void;
  onShareRoute: () => void;
  onClearRoute: () => void;
};

type FeedEntry = {
  id: string;
  kind: 'system' | 'self' | 'peer';
  author: string;
  body: string;
  ts: number;
};

function parseTimestamp(line: string, index: number) {
  const match = /^\[(.+?)\]\s*/.exec(line);
  const body = match ? line.slice(match[0].length) : line;
  if (!match) {
    return { ts: Date.now() + index, body };
  }
  const parsed = Date.parse(match[1]);
  return { ts: Number.isFinite(parsed) ? parsed : Date.now() + index, body };
}

function formatFeedTime(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return '--:--';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '--:--';
  }
}

export function ControllerChatPanel(props: ControllerChatPanelProps) {
  const {
    sessionId,
    inviteUrl,
    inviteCopied,
    isCoopHost,
    participants,
    messages,
    terminalOutput,
    sharedPlan,
    selectedRouteReady,
    currentUserId,
    className,
    onHide,
    onSendChat,
    onStartSession,
    onCopyInvite,
    onShareRoute,
    onClearRoute,
  } = props;
  const [draft, setDraft] = useState('');
  const [roomOpen, setRoomOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const feedEntries = useMemo<FeedEntry[]>(() => {
    const systemEntries = terminalOutput.map((line, index) => {
      const parsed = parseTimestamp(line, index);
      return {
        id: `system-${index}-${parsed.ts}`,
        kind: 'system' as const,
        author: 'system',
        body: parsed.body,
        ts: parsed.ts,
      };
    });
    const userEntries = messages.map((message) => ({
      id: message.id,
      kind: message.authorId === currentUserId ? ('self' as const) : ('peer' as const),
      author: message.author || 'participant',
      body: message.text,
      ts: message.ts,
    }));
    return [...systemEntries, ...userEntries].sort((a, b) => a.ts - b.ts).slice(-120);
  }, [currentUserId, messages, terminalOutput]);

  useEffect(() => {
    const node = feedRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [feedEntries]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSendChat(text);
    setDraft('');
  };

  const participantCount = participants.length;
  const onlineCount = participants.filter((entry) => entry.isOnline !== false).length;

  return (
    <>
      <Card className={cn('border-border/70 bg-card/92', className)}>
        <CardContent className="flex h-full min-h-0 flex-col gap-3 p-3">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-1">
              <MessageSquare className="size-3.5 text-muted-foreground" />
              <span className="truncate text-xs font-medium">{sessionId ? `room ${sessionId.slice(0, 6)}` : 'chat'}</span>
              <span className="text-[10px] text-muted-foreground">
                {onlineCount}/{participantCount}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {!sessionId ? (
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onStartSession} title="Start coop session">
                  <Play className="size-3.5" />
                </Button>
              ) : (
                <>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRoomOpen(true)} title="Room controls">
                    <List className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRosterOpen(true)} title="Participants">
                    <Users className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={onShareRoute}
                    disabled={!selectedRouteReady}
                    title="Share current plan"
                  >
                    <Route className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={onClearRoute}
                    disabled={!sharedPlan || !isCoopHost}
                    title="Clear shared plan"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              )}
              {onHide && (
                <Button size="icon" variant="ghost" onClick={onHide} aria-label="Hide chat" title="Hide chat" className="h-7 w-7">
                  <Minimize2 className="size-3.5" />
                </Button>
              )}
            </div>
          </div>

          <div
            ref={feedRef}
            className="min-h-[16rem] flex-1 overflow-y-auto rounded-lg border border-slate-800 bg-black px-3 py-3 font-mono text-xs shadow-inner"
          >
            {feedEntries.length === 0 ? (
              <div className="text-slate-500">[awaiting traffic]</div>
            ) : (
              <div className="space-y-1.5">
                {feedEntries.map((entry) => (
                  <article
                    key={entry.id}
                    className={cn(
                      'grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded px-2 py-1',
                      entry.kind === 'system'
                        ? 'bg-emerald-500/6 text-emerald-300'
                        : entry.kind === 'self'
                          ? 'bg-white/5 text-slate-100'
                          : 'bg-amber-500/6 text-amber-300'
                    )}
                  >
                    <span className="text-[10px] text-white/40">{formatFeedTime(entry.ts)}</span>
                    <div className="min-w-0">
                      <span className="mr-1 uppercase tracking-[0.16em] text-[10px] text-white/35">{entry.author}</span>
                      <span className="break-words">{entry.body}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
              placeholder={sessionId ? 'Type message' : 'Start session to chat'}
              disabled={!sessionId}
              className="h-9 border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-500"
            />
            <Button size="icon" onClick={submit} disabled={!sessionId || !draft.trim()} title="Send message" className="h-9 w-9">
              <Send className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <OverlayModal open={roomOpen} title="Room Controls" onClose={() => setRoomOpen(false)} maxWidthClassName="max-w-md">
        <div className="grid gap-3 text-sm">
          <div className="truncate rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            {inviteUrl || 'Invite unavailable'}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void onCopyInvite()} disabled={!inviteUrl}>
              <Copy className="mr-2 size-3.5" />
              {inviteCopied ? 'Copied' : 'Copy Invite'}
            </Button>
            <Button size="sm" variant="outline" onClick={onShareRoute} disabled={!selectedRouteReady}>
              <Route className="mr-2 size-3.5" />
              Share Plan
            </Button>
            <Button size="sm" variant="ghost" onClick={onClearRoute} disabled={!sharedPlan || !isCoopHost}>
              <Trash2 className="mr-2 size-3.5" />
              Clear Plan
            </Button>
          </div>
        </div>
      </OverlayModal>

      <OverlayModal open={rosterOpen} title="Participants" onClose={() => setRosterOpen(false)} maxWidthClassName="max-w-md">
        <div className="grid gap-2">
          {participants.length === 0 ? (
            <div className="text-sm text-muted-foreground">No participants connected.</div>
          ) : (
            participants.map((participant) => (
              <div key={participant.userId} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{participant.username}</div>
                  <div className="text-xs text-muted-foreground">
                    {participant.role} · {participant.vehicleId || 'no vehicle'}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {participant.isOnline === false ? 'offline' : participant.isSpeaking ? 'speaking' : participant.isActive ? 'active' : 'idle'}
                </div>
              </div>
            ))
          )}
        </div>
      </OverlayModal>
    </>
  );
}
