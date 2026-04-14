import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoopChatMessage, CoopParticipant, CoopSharedPlan } from '@shared/types';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Input } from '@/app/components/ui/input';
import { CoopSessionControlOverlay } from '@/app/components/realtime/coop/CoopSessionControlOverlay';
import { cn } from '@/app/components/ui/utils';
import { Eye, EyeOff, MessageSquare, Minimize2, Send, Settings2, Trash2 } from 'lucide-react';

type ControllerChatPanelProps = {
  sessionId: string;
  inviteUrl: string;
  inviteCopied: boolean;
  isCoopHost: boolean;
  participants: CoopParticipant[];
  messages: CoopChatMessage[];
  terminalOutput: string[];
  sharedPlan?: CoopSharedPlan | null;
  currentUserId?: string;
  coopVehicleId?: string;
  className?: string;
  onHide?: () => void;
  onSendChat: (text: string) => void;
  onHostSession: () => void;
  onJoinSession: (sessionId: string, asSpectator: boolean) => void;
  onLeaveSession: () => void;
  onCopyInvite: () => Promise<void> | void;
  onClearRoute: () => void;
  onClearChat: () => void;
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
    currentUserId,
    coopVehicleId,
    className,
    onHide,
    onSendChat,
    onHostSession,
    onJoinSession,
    onLeaveSession,
    onCopyInvite,
    onClearRoute,
    onClearChat,
  } = props;
  const [draft, setDraft] = useState('');
  const [roomOpen, setRoomOpen] = useState(false);
  const [showSystemMessages, setShowSystemMessages] = useState(true);
  const [joinSessionDraft, setJoinSessionDraft] = useState(sessionId);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setJoinSessionDraft(sessionId);
  }, [sessionId]);

  const systemEntries = useMemo<FeedEntry[]>(() => {
    return terminalOutput.map((line, index) => {
      const parsed = parseTimestamp(line, index);
      return {
        id: `system-${index}-${parsed.ts}`,
        kind: 'system' as const,
        author: 'server',
        body: parsed.body,
        ts: parsed.ts,
      };
    });
  }, [terminalOutput]);

  const userEntries = useMemo<FeedEntry[]>(() => {
    return messages.map((message) => ({
      id: message.id,
      kind: message.authorId === currentUserId ? ('self' as const) : ('peer' as const),
      author: message.author || 'participant',
      body: message.text,
      ts: message.ts,
    }));
  }, [currentUserId, messages]);

  const latestSystemEntry = useMemo(
    () => (showSystemMessages ? systemEntries[systemEntries.length - 1] ?? null : null),
    [showSystemMessages, systemEntries]
  );

  useEffect(() => {
    const node = feedRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [userEntries, latestSystemEntry]);

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
      <Card className={cn('h-[min(70vh,42rem)] max-h-[calc(100vh-10rem)] min-h-[20rem] border-border/70 bg-card/92', className)}>
        <CardContent className="flex h-full min-h-0 flex-col gap-3 p-3">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-1">
              <MessageSquare className="size-3.5 text-muted-foreground" />
              <span className="truncate text-xs font-medium">{sessionId ? `room ${sessionId.slice(0, 6)}` : 'chat'}</span>
              <span className="text-[10px] text-muted-foreground">
                {onlineCount}/{participantCount}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setShowSystemMessages((prev) => !prev)}
                aria-label={showSystemMessages ? 'Hide system messages' : 'Show system messages'}
                title={showSystemMessages ? 'Hide system messages' : 'Show system messages'}
              >
                {showSystemMessages ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRoomOpen(true)} title="Coop">
                <Settings2 className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onClearChat}
                aria-label="Clear chat messages"
                title="Clear chat messages"
                disabled={!sessionId}
              >
                <Trash2 className="size-3.5" />
              </Button>
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
            {!latestSystemEntry && userEntries.length === 0 ? (
              <div className="text-slate-500">[awaiting traffic]</div>
            ) : (
              <div className="flex min-h-full flex-col">
                {latestSystemEntry && (
                  <article className="sticky top-0 z-10 mb-3 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded border border-emerald-500/20 bg-black/95 px-2 py-1 text-emerald-300 shadow-[0_8px_16px_rgba(0,0,0,0.3)] backdrop-blur">
                    <span className="text-[10px] text-white/40">{formatFeedTime(latestSystemEntry.ts)}</span>
                    <div className="min-w-0">
                      <span className="mr-1 uppercase tracking-[0.16em] text-[10px] text-white/35">{latestSystemEntry.author}</span>
                      <span className="break-words">{latestSystemEntry.body}</span>
                    </div>
                  </article>
                )}
                <div className="mt-auto space-y-1.5">
                  {userEntries.map((entry) => (
                    <article
                      key={entry.id}
                      className={cn(
                        'grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded px-2 py-1',
                        entry.kind === 'self' ? 'bg-white/5 text-slate-100' : 'bg-amber-500/6 text-amber-300'
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

      <CoopSessionControlOverlay
        open={roomOpen}
        sessionId={sessionId}
        joinSessionDraft={joinSessionDraft}
        coopVehicleId={coopVehicleId}
        inviteUrl={inviteUrl}
        inviteCopied={inviteCopied}
        participants={participants}
        isCoopHost={isCoopHost}
        sharedPlan={sharedPlan}
        onClose={() => setRoomOpen(false)}
        onJoinSessionDraftChange={setJoinSessionDraft}
        onHostSession={onHostSession}
        onJoinSession={onJoinSession}
        onLeaveSession={onLeaveSession}
        onCopyInvite={onCopyInvite}
        onClearRoute={onClearRoute}
      />
    </>
  );
}
