const REGISTRY_KEY = '__ivySecondaryWindows';

type WindowRegistry = Set<Window>;

function getRegistry(): WindowRegistry {
  const w = window as typeof window & { [REGISTRY_KEY]?: WindowRegistry };
  if (!w[REGISTRY_KEY]) {
    w[REGISTRY_KEY] = new Set<Window>();
  }
  return w[REGISTRY_KEY]!;
}

export function registerSecondaryWindow(win: Window | null) {
  if (!win) return;
  const registry = getRegistry();
  registry.add(win);
  const cleanup = () => registry.delete(win);
  win.addEventListener('beforeunload', cleanup);
}

export function closeSecondaryWindows() {
  const registry = getRegistry();
  registry.forEach((entry) => {
    try {
      if (!entry.closed) {
        entry.close();
      }
    } catch {
      // Ignore cross-window errors.
    }
  });
  registry.clear();
}

export function isSecondaryDisplay() {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    const isFocus = Boolean(url.searchParams.get('focus'));
    return isFocus && url.pathname === '/control';
  } catch {
    return false;
  }
}
