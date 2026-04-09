import { useEffect, useRef } from 'react';
import { useWebRtcSubscriber } from '@/app/hooks/useWebRtcSubscriber';
import { Maximize2 } from 'lucide-react';

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
    <section className={`rounded-xl border border-border bg-card p-4 ${className || ''}`}>
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Video</h3>
        <span className="text-xs text-muted-foreground">
          {isConnected ? 'Live' : isConnecting ? 'Connecting' : 'Idle'}
        </span>
      </header>

      <div className={`relative ${hideFooter ? '' : 'mb-3'}`}>
        <video
          ref={videoRef}
          playsInline
          muted
          controls={false}
          className={`h-56 w-full rounded-lg border border-border/60 bg-black object-cover ${videoClassName || ''}`}
        />
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

      {!hideFooter && (
        <>
          <div className="mb-3 text-xs text-muted-foreground">
            Signaling: {signalingConnected ? 'connected' : 'disconnected'}
            {error ? ` | ${error}` : ''}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm"
              onClick={() => void connect()}
              disabled={isConnecting}
            >
              Start Stream
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm"
              onClick={disconnect}
            >
              Stop
            </button>
          </div>
        </>
      )}
    </section>
  );
}

