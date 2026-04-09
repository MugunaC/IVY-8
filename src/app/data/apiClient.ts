const DEFAULT_API_PORT = '3100';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  const configured = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE;
  if (configured) {
    return trimTrailingSlash(configured);
  }

  if (typeof window === 'undefined') {
    return `http://127.0.0.1:${DEFAULT_API_PORT}`;
  }

  // In browsers, default to same-origin and let Vite proxy /api in dev.
  // This keeps remote/tunneled access working without exposing API port directly.
  return '';
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await parseResponse<{ error?: string } | string>(response);
    const message =
      typeof body === 'string' ? body : body?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return parseResponse<T>(response);
}
