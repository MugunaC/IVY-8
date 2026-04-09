export function isPerfEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('perf') === '1') return true;
    return window.localStorage.getItem('ivy.perf') === '1';
  } catch {
    return false;
  }
}
