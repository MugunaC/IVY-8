import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import process from 'node:process';

const API_BASE = 'http://127.0.0.1:3100';
const SERVER_ENTRY = 'dist-server/server/index.js';

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

async function waitForHealth(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) return true;
    } catch {
      // Retry until timeout.
    }
    await sleep(250);
  }
  return false;
}

function startServer() {
  return spawn(process.execPath, [SERVER_ENTRY], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WS_HOST: '127.0.0.1',
    },
  });
}

async function runHttpScenario({ clients, perClientRps, durationSec }) {
  const endAt = Date.now() + durationSec * 1000;
  const intervalMs = Math.max(1, Math.floor(1000 / perClientRps));

  let total = 0;
  let ok201 = 0;
  let dropped202 = 0;
  let httpError = 0;
  let networkError = 0;
  const latencies = [];

  const workers = Array.from({ length: clients }, (_, clientIdx) => (async () => {
    let seq = 0;
    while (Date.now() < endAt) {
      const ts = Date.now();
      const body = {
        ts,
        userId: `bench-user-${clientIdx}`,
        vehicleId: `bench-vehicle-${clientIdx % 8}`,
        payload: {
          buttons: [1, 0, 0, 0, 0, 0, 0.2, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          axes: [0.1, -0.2, 0.4, -0.1],
        },
        bytes: 96,
        id: ts + seq,
      };
      seq += 1;

      const t0 = performance.now();
      try {
      const res = await fetch(`${API_BASE}/api/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const dt = performance.now() - t0;
        latencies.push(dt);
        total += 1;
        if (res.status === 201) {
          ok201 += 1;
        } else if (res.status === 202) {
          dropped202 += 1;
        } else {
          httpError += 1;
        }
      } catch {
        networkError += 1;
      }
      await sleep(intervalMs);
    }
  })());

  const started = Date.now();
  await Promise.all(workers);
  const elapsedSec = Math.max(0.001, (Date.now() - started) / 1000);

  return {
    clients,
    perClientRps,
    durationSec,
    total,
    ok201,
    dropped202,
    httpError,
    networkError,
    achievedRps: Number((total / elapsedSec).toFixed(1)),
    successRps: Number((ok201 / elapsedSec).toFixed(1)),
    p50Ms: Number(percentile(latencies, 50).toFixed(1)),
    p95Ms: Number(percentile(latencies, 95).toFixed(1)),
    p99Ms: Number(percentile(latencies, 99).toFixed(1)),
  };
}

function printResult(result) {
  const line = [
    `clients=${result.clients}`,
    `rate/client=${result.perClientRps}/s`,
    `sent=${result.total}`,
    `ok=${result.ok201}`,
    `drop202=${result.dropped202}`,
    `httpErr=${result.httpError}`,
    `netErr=${result.networkError}`,
    `rps=${result.achievedRps}`,
    `okRps=${result.successRps}`,
    `p50=${result.p50Ms}ms`,
    `p95=${result.p95Ms}ms`,
    `p99=${result.p99Ms}ms`,
  ];
  console.log(line.join(' | '));
}

async function main() {
  const server = startServer();
  let serverStdout = '';
  let serverStderr = '';
  server.stdout?.on('data', (chunk) => {
    serverStdout += chunk.toString();
  });
  server.stderr?.on('data', (chunk) => {
    serverStderr += chunk.toString();
  });

  try {
    const healthy = await waitForHealth();
    if (!healthy) {
      throw new Error('Server did not become healthy in time.');
    }

    const scenarios = [
      { clients: 5, perClientRps: 10, durationSec: 12 },
      { clients: 10, perClientRps: 10, durationSec: 12 },
      { clients: 20, perClientRps: 10, durationSec: 12 },
      { clients: 30, perClientRps: 12, durationSec: 12 },
      { clients: 40, perClientRps: 12, durationSec: 12 },
      { clients: 50, perClientRps: 15, durationSec: 12 },
    ];

    console.log('HTTP input benchmark starting...');
    const results = [];
    for (const scenario of scenarios) {
      const result = await runHttpScenario(scenario);
      results.push(result);
      printResult(result);
      await sleep(600);
    }

    const acceptable = results.filter(
      (r) => r.dropped202 === 0 && r.httpError === 0 && r.networkError === 0 && r.p95Ms <= 250
    );
    const best = acceptable.at(-1) || null;
    console.log('\nSummary:');
    if (best) {
      console.log(
        `best_reasonable: clients=${best.clients}, rate/client=${best.perClientRps}/s, okRps=${best.successRps}, p95=${best.p95Ms}ms`
      );
    } else {
      console.log('best_reasonable: none (all scenarios exceeded threshold)');
    }
  } finally {
    server.kill('SIGTERM');
    await sleep(500);
    if (server.exitCode === null) {
      server.kill('SIGKILL');
    }
    if (serverStderr.trim()) {
      console.log('\nServer stderr (tail):');
      console.log(serverStderr.trim().split('\n').slice(-10).join('\n'));
    }
    if (serverStdout.trim()) {
      console.log('\nServer stdout (tail):');
      console.log(serverStdout.trim().split('\n').slice(-10).join('\n'));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
