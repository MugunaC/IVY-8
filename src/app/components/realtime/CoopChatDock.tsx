import { useState } from 'react';
import { ChevronUp, MessageSquare, Send, Route, Users } from 'lucide-react';
import type { CoopStatePayload } from '@shared/types';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';

type CoopChatDockProps = {
  coopState: CoopStatePayload;
  className?: string;
  showRouteBadge?: boolean;
  onSendChat: (text: string) => void;
  onClearRoute?: () => void;
};

export function CoopChatDock(props: CoopChatDockProps) {
  const { coopState, className, showRouteBadge = true, onSendChat, onClearRoute } = props;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const recentMessages = coopState.messages.slice(-3);
  const participantCount = coopState.participants.length;
  const lastMessage = coopState.messages[coopState.messages.length - 1] || null;

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSendChat(text);
    setValue('');
  };

  return (
    <div className={className}>
      <div className="pointer-events-auto flex w-[22rem] max-w-[92vw] flex-col gap-2 rounded-[1.6rem] border border-border/70 bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(15,23,42,0.82))] p-3 text-xs text-white shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/55">
              <MessageSquare className="size-3.5" />
              Mission Room
            </div>
            <div className="mt-1 truncate text-sm font-semibold">
              {coopState.sessionId ? `Session ${coopState.sessionId.slice(0, 8)}` : 'Session chat'}
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="rounded-full text-white/80 hover:bg-white/10 hover:text-white"
            onClick={() => setOpen((prev) => !prev)}
            title={open ? 'Collapse' : 'Expand'}
          >
            <ChevronUp className={`size-4 transition-transform ${open ? '' : 'rotate-180'}`} />
          </Button>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/70">
          <span className="flex items-center gap-2">
            <Users className="size-3.5" />
            {participantCount} in room
          </span>
          <span>{lastMessage ? `${lastMessage.author} active` : 'Quiet channel'}</span>
        </div>
        {showRouteBadge && coopState.sharedRoute && (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px]">
            <div className="flex items-center gap-2 truncate">
              <Route className="size-3" />
              <span className="truncate">
                {coopState.sharedRoute.label || 'Shared coordinated route'} by {coopState.sharedRoute.author}
              </span>
            </div>
            {onClearRoute && (
              <Button size="sm" variant="ghost" onClick={onClearRoute} className="h-6 rounded-full px-2 text-[11px] text-white hover:bg-white/10">
                Clear
              </Button>
            )}
          </div>
        )}
        {!open ? (
          <div className="rounded-2xl border border-white/10 bg-black/15 p-3">
            {recentMessages.length === 0 ? (
              <div className="text-white/55">No chat activity yet.</div>
            ) : (
              <div className="space-y-2">
                {recentMessages.map((message) => (
                  <div key={message.id} className="truncate text-white/80">
                    <span className="font-semibold text-white">{message.author}:</span> {message.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="max-h-44 overflow-y-auto rounded-2xl border border-white/10 bg-black/15 p-3">
              {coopState.messages.length === 0 ? (
                <div className="text-white/55">No chat activity yet.</div>
              ) : (
                coopState.messages.map((message) => (
                  <div key={message.id} className="mb-2 rounded-xl bg-white/5 px-3 py-2">
                    <div className="font-semibold text-white">{message.author}</div>
                    <div className="mt-1 text-white/80">{message.text}</div>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit();
                }}
                placeholder="Message session"
                className="border-white/10 bg-white/10 text-white placeholder:text-white/40"
              />
              <Button size="icon" onClick={submit} title="Send message" className="rounded-full bg-white text-slate-950 hover:bg-white/90">
                <Send className="size-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
