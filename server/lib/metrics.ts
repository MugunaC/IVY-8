export function metricKey(parts: Array<string | number | undefined>) {
  return parts
    .map((part) => (part === undefined || part === '' ? 'unknown' : String(part)))
    .join('|');
}

export function incMetric(map: Map<string, number>, key: string, value = 1) {
  map.set(key, (map.get(key) || 0) + value);
}

function formatPromLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function formatPromLines(map: Map<string, number>, metric: string, labels: string[]) {
  const lines: string[] = [];
  for (const [key, value] of map.entries()) {
    const parts = key.split('|');
    const labelPairs = labels
      .map((name, idx) => `${name}="${formatPromLabel(parts[idx] || 'unknown')}"`)
      .join(',');
    lines.push(`${metric}{${labelPairs}} ${value}`);
  }
  return lines;
}
