import { Menu } from 'lucide-react';
import { Button } from '@/app/components/ui/button';

type InsightView = 'user' | 'diagnostics';

interface ControllerQuickMenuProps {
  open: boolean;
  onToggle: () => void;
  onSelect: (view: InsightView) => void;
}

export function ControllerQuickMenu(props: ControllerQuickMenuProps) {
  const { open, onToggle, onSelect } = props;
  return (
    <div className="relative z-[141]">
      <Button
        variant="outline"
        size="icon"
        onClick={onToggle}
        aria-expanded={open}
        aria-label="Toggle navigation"
      >
        <Menu className="size-4" />
      </Button>
      {open && (
        <div className="absolute right-0 z-[190] mt-2 w-44 rounded-md border border-border bg-card shadow-lg ring-1 ring-black/5 dark:ring-white/10">
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            onClick={() => onSelect('user')}
          >
            User
          </button>
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            onClick={() => onSelect('diagnostics')}
          >
            Live Diagnostics
          </button>
        </div>
      )}
    </div>
  );
}
