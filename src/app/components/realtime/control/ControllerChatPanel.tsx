import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoopChatMessage, CoopParticipant, CoopSharedRoute } from '@shared/types';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent, CardTitle } from '@/app/components/ui/card';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Input } from '@/app/components/ui/input';
import { cn } from '@/app/components/ui/utils';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  MessageSquare,
  Route,
  Send,
  Terminal,
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
  sharedRoute?: CoopSharedRoute | null;
  selectedRouteReady: boolean;
  className?: string;
  onHide?: () => void;
  onSendChat: (text: string) => void;
  onStartSession: () => void;
  onCopyInvite: () => Promise<void> | void;
  onShareRoute: () => void;
  onClearRoute: () => void;
};

type FeedEntry =
  | {
      id: string;
      kind: 'system';
      author: string;
      body: string;
      ts: number;
    }
  | {
      id: string;
      kind: 'user';
      author: string;
      body: string;
      ts: number;
    };

function parseTimestamp(line: string, index: number) {
  const match = /^\[(.+?)\]\s*/.exec(line);
  const body = match ? line.slice(match[0].length) : line;
  if (!match) {
    return {
      ts: index,
      body,
    };
  }
  const parsed = Date.parse(match[1]);
  return {
    ts: Number.isFinite(parsed) ? parsed : index,
    body,
  };
}

function formatFeedTime(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return '--';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--';
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
    sharedRoute,
    selectedRouteReady,
    className,
    onHide,
    onSendChat,
    onStartSession,
    onCopyInvite,
    onShareRoute,
    onClearRoute,
  } = props;
  const [draft, setDraft] = useState('');
  const [showSystem, setShowSystem] = useState(true);
  const [showUsers, setShowUsers] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(true);
  const [rosterOpen, setRosterOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const feedEntries = useMemo<FeedEntry[]>(() => {
    const systemEntries = terminalOutput.map((line, index) => {
      const parsed = parseTimestamp(line, index);
      return {
        id: `system-${index}-${parsed.ts}`,
        kind: 'system' as const,
        author: 'System',
        body: parsed.body,
        ts: parsed.ts,
      };
    });
    const userEntries = messages.map((message) => ({
      id: message.id,
      kind: 'user' as const,
      author: message.author || 'User',
      body: message.text,
      ts: message.ts,
    }));
    return [...systemEntries, ...userEntries]
      .filter((entry) => (entry.kind === 'system' ? showSystem : showUsers))
      .sort((a, b) => a.ts - b.ts)
      .slice(-120);
  }, [messages, showSystem, showUsers, terminalOutput]);

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

  const drivers = participants.filter((entry) => entry.role !== 'spectator').length;
  const spectators = participants.filter((entry) => entry.role === 'spectator').length;

  return (
    <Card className={cn('border-border/70 bg-card/92', className)}>
      <CardContent className="flex h-full min-h-0 flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Chat</CardTitle>
            <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px]">
              {sessionId ? `R:${sessionId.slice(0, 6)}` : 'No room'}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Checkbox checked={showSystem} onCheckedChange={(value) => setShowSystem(value === true)} />
              <Terminal className="size-3" />
              Sys
            </label>
            <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Checkbox checked={showUsers} onCheckedChange={(value) => setShowUsers(value === true)} />
              <Users className="size-3" />
              Users
            </label>
            {onHide && (
              <Button size="icon" variant="outline" onClick={onHide} aria-label="Hide chat" title="Hide chat" className="h-8 w-8 rounded-full">
                <ChevronDown className="size-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-2">
          <section className="rounded-xl border border-border/70 bg-muted/20">
            <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left" onClick={() => setActionsOpen((prev) => !prev)}>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-foreground">Room</span>
                <span className="text-muted-foreground">{drivers} drv · {spectators} spec</span>
                {sharedRoute ? <span className="text-muted-foreground">route:{sharedRoute.author}</span> : null}
              </div>
              {actionsOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
            {actionsOpen && (
              <div className="grid gap-2 border-t border-border/60 px-3 py-2">
                {!sessionId ? (
                  <Button size="sm" onClick={onStartSession}>Start Room</Button>
                ) : (
                  <>
                    <div className="truncate text-[11px] text-muted-foreground">{inviteUrl || 'Invite unavailable'}</div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void onCopyInvite()} disabled={!inviteUrl}>
                        <Copy className="mr-2 size-3.5" />
                        {inviteCopied ? 'Copied' : 'Copy'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={onShareRoute} disabled={!selectedRouteReady}>
                        <Route className="mr-2 size-3.5" />
                        Share
                      </Button>
                      <Button size="sm" variant="ghost" onClick={onClearRoute} disabled={!sharedRoute || !isCoopHost}>
                        Clear
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border/70 bg-muted/20">
            <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left" onClick={() => setRosterOpen((prev) => !prev)}>
              <div className="text-xs">
                <span className="font-medium text-foreground">Roster</span>
                <span className="ml-2 text-muted-foreground">{participants.length} in room</span>
              </div>
              {rosterOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
            {rosterOpen && (
              <div className="grid gap-1.5 border-t border-border/60 px-3 py-2">
                {participants.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Nobody has joined the room yet.</div>
                ) : (
                  participants.map((participant) => (
                    <div key={participant.userId} className="flex items-center justify-between gap-2 rounded-lg bg-background/70 px-2 py-1.5 text-xs">
                      <span className="truncate font-medium">{participant.username}</span>
                      <span className="text-muted-foreground">{participant.isHost ? 'Host' : participant.role === 'spectator' ? 'Spec' : 'Drv'}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        </div>

        <div ref={feedRef} className="min-h-[18rem] flex-1 overflow-y-auto rounded-xl border border-border/70 bg-slate-950/95 px-2 py-2 shadow-inner">
          {feedEntries.length === 0 ? (
            <div className="px-1 text-xs text-slate-400">No visible messages.</div>
          ) : (
            <div className="space-y-1.5">
              {feedEntries.map((entry) => (
                <article
                  key={entry.id}
                  className={cn(
                    'rounded-lg border-l-2 px-2 py-1.5 text-xs',
                    entry.kind === 'system'
                      ? 'border-l-sky-400 bg-sky-500/5 text-slate-100'
                      : 'border-l-emerald-400 bg-emerald-500/5 text-slate-100'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate">
                      <span className={cn('font-semibold', entry.kind === 'system' ? 'text-sky-200' : 'text-emerald-200')}>{entry.author}</span>
                    </div>
                    <span className="shrink-0 text-[10px] text-white/45">{formatFeedTime(entry.ts)}</span>
                  </div>
                  <div className="mt-0.5 break-words leading-5 text-white/88">{entry.body}</div>
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
            placeholder={sessionId ? 'Message room' : 'Start room to chat'}
            disabled={!sessionId}
            className="h-9"
          />
          <Button size="icon" onClick={submit} disabled={!sessionId || !draft.trim()} title="Send message" className="h-9 w-9">
            <Send className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
