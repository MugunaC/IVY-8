import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/app/components/ui/button';
import { X } from 'lucide-react';

interface OverlayModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
}

export function OverlayModal(props: OverlayModalProps) {
  const { open, title, onClose, children, maxWidthClassName = 'max-w-lg' } = props;
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-black/55 px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`max-h-[calc(100vh-4rem)] w-full overflow-y-auto ${maxWidthClassName} rounded-2xl border border-border bg-card p-5 shadow-2xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-semibold">{title}</div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
