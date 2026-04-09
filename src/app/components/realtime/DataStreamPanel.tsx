import type { RefObject } from 'react';
import { Button } from '@/app/components/ui/button';
import { Minimize2 } from 'lucide-react';

interface DataStreamPanelProps {
  terminalOutput: string[];
  terminalRef: RefObject<HTMLDivElement>;
  onHide?: () => void;
  heightClassName?: string;
}

export function DataStreamPanel(props: DataStreamPanelProps) {
  const { terminalOutput, terminalRef, onHide, heightClassName = 'h-[120px]' } = props;
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Data Stream</h3>
        {onHide && (
          <Button
            size="icon"
            variant="outline"
            onClick={onHide}
            aria-label="Hide data stream"
            title="Hide data stream"
            className="rounded-full"
          >
            <Minimize2 className="size-4" />
          </Button>
        )}
      </header>
      <div ref={terminalRef} className={`${heightClassName} overflow-y-auto rounded-lg bg-black p-3 font-mono text-xs text-green-400`}>
        {terminalOutput.length === 0 ? (
          <div className="text-muted-foreground">Waiting for events...</div>
        ) : (
          terminalOutput.map((line, index) => (
            <div key={index} className="mb-1">
              {line}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
