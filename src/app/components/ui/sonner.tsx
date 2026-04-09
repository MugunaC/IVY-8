import type { CSSProperties } from 'react';
import { useTheme } from '@/app/context/ThemeContext';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

export function Toaster(props: ToasterProps) {
  const { theme } = useTheme();
  const resolvedTheme = theme === 'dark' ? 'dark' : 'light';

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}
