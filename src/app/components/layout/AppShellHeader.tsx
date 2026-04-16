import type { ReactNode } from 'react';

interface AppShellHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AppShellHeader(props: AppShellHeaderProps) {
  const { title, subtitle, actions } = props;

  return (
    <header className="app-header-shell">
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle ? (
            <p className="text-sm text-[color:var(--app-header-muted)]">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
