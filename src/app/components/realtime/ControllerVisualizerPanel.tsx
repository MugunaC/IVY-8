import type { RefObject } from 'react';
import { Button } from '@/app/components/ui/button';
import { Minimize2 } from 'lucide-react';

interface ControllerVisualizerPanelProps {
  inputPaused: boolean;
  onToggleInputPaused: () => void;
  onHide?: () => void;
  visualizerRef: RefObject<HTMLIFrameElement>;
  visualizerContainerRef: RefObject<HTMLDivElement>;
  visualizerHeight: number;
  visualizerMaxHeight: number;
  onLoad?: () => void;
}

export function ControllerVisualizerPanel(props: ControllerVisualizerPanelProps) {
  const {
    inputPaused,
    onToggleInputPaused,
    onHide,
    visualizerRef,
    visualizerContainerRef,
    visualizerHeight,
    visualizerMaxHeight,
    onLoad,
  } = props;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Controller Visualizer</h3>
        <div className="flex items-center gap-2">
          <Button variant={inputPaused ? 'default' : 'outline'} size="sm" onClick={onToggleInputPaused}>
            {inputPaused ? 'Resume Input' : 'Pause Input'}
          </Button>
          {onHide && (
            <Button
              size="icon"
              variant="outline"
              onClick={onHide}
              aria-label="Hide controller visualizer"
              title="Hide controller visualizer"
              className="rounded-full"
            >
              <Minimize2 className="size-4" />
            </Button>
          )}
        </div>
      </header>
      <div ref={visualizerContainerRef} className="w-full">
        <iframe
          ref={visualizerRef}
          src="/visualizer.html"
          title="Controller Visualizer"
          className="w-full overflow-hidden rounded-lg border border-border/60 bg-black"
          scrolling="no"
          style={{ height: Math.min(visualizerHeight, visualizerMaxHeight) }}
          onLoad={onLoad}
        />
      </div>
    </section>
  );
}
