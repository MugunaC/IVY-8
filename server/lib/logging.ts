export function logWsVerbose(
  enabled: boolean,
  message: string,
  context?: {
    endpoint?: string;
    connectionId?: string;
  }
) {
  if (!enabled) return;
  const endpoint = context?.endpoint ? `endpoint=${context.endpoint}` : '';
  const connectionId = `conn=${context?.connectionId || 'unknown'}`;
  const prefix = [endpoint, connectionId].filter(Boolean).join(' ');
  console.log(`[WS_VERBOSE] ${prefix ? `${prefix} ` : ''}${message}`);
}

export function logStructured(
  level: 'info' | 'warn' | 'error',
  event: string,
  details: Record<string, unknown> = {}
) {
  const payload = {
    level,
    event,
    ts: new Date().toISOString(),
    ...details,
  };
  console.log(JSON.stringify(payload));
}
