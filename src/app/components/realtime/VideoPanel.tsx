import { useEffect, useRef } from 'react';
import { useWebRtcSubscriber } from '@/app/hooks/useWebRtcSubscriber';
import { Maximize2, Play, Square } from 'lucide-react';

interface VideoPanelProps {
  signalingUrl: string;
  roomId: string;
  viewerId: string;
  token?: string;
  className?: string;
  videoClassName?: string;
  hideFooter?: boolean;
}

export function VideoPanel(props: VideoPanelProps) {
  const { signalingUrl, roomId, viewerId, token, className, videoClassName, hideFooter = false } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const toggleFullscreen = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    const candidate = video as HTMLVideoElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
      webkitEnterFullscreen?: () => Promise<void> | void;
    };
    if (typeof video.requestFullscreen === 'function') {
      await video.requestFullscreen().catch(() => undefined);
      return;
    }
    if (typeof candidate.webkitRequestFullscreen === 'function') {
      candidate.webkitRequestFullscreen();
      return;
    }
    if (typeof candidate.webkitEnterFullscreen === 'function') {
      candidate.webkitEnterFullscreen();
    }
  };
  const {
    stream,
    isConnected,
    isConnecting,
    error,
    signalingConnected,
    connect,
    disconnect,
  } = useWebRtcSubscriber({
    signalingUrl,
    roomId,
    viewerId,
    token,
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) {
      void video.play().catch(() => {
        // Autoplay may be blocked by browser policy.
      });
    }
  }, [stream]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return (
    <section className={`flex h-full min-h-0 flex-col rounded-xl border border-border bg-card p-4 ${className || ''}`}>
      <header className="mb-3 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-sm font-semibold">Video</h3>
          <span className="truncate text-xs text-muted-foreground">
            {isConnected ? 'Live' : isConnecting ? 'Connecting' : 'Idle'}
            {error ? ` | ${error}` : signalingConnected ? ' | signaling ok' : ' | signaling down'}
          </span>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          playsInline
          muted
          controls={false}
          className={`h-full min-h-0 w-full rounded-lg border border-border/60 bg-black object-cover ${videoClassName || ''}`}
        />
        {!hideFooter && (
          <div className="absolute bottom-2 left-2 flex gap-2">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/20 bg-black/55 text-white"
              onClick={() => void connect()}
              disabled={isConnecting}
              title="Start stream"
              aria-label="Start stream"
            >
              <Play className="size-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/20 bg-black/55 text-white"
              onClick={disconnect}
              title="Stop stream"
              aria-label="Stop stream"
            >
              <Square className="size-4" />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          className="absolute bottom-2 right-2 rounded-md border border-white/20 bg-black/55 p-1.5 text-white"
          aria-label="Toggle fullscreen"
          title="Fullscreen"
        >
          <Maximize2 className="size-4" />
        </button>
      </div>
    </section>
  );
}

