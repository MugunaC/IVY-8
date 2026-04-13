export function ControllerPanelFallback(props: { title: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{props.title}</h3>
        <span className="text-xs text-muted-foreground">Loading</span>
      </header>
      <div className="h-56 w-full animate-pulse rounded-lg bg-muted/60" />
    </section>
  );
}
