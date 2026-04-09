import ws from 'k6/ws';
import { check, sleep } from 'k6';

const WS_URL = __ENV.WS_URL || 'ws://localhost:3001';
const VEHICLE_ID = __ENV.VEHICLE_ID || 'VH-001';
const HZ = Number(__ENV.HZ || 100);

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || '30s',
};

function buildPayload() {
  const buttons = Array(18).fill(0);
  const axes = Array(4).fill(0);
  return { buttons, axes, vehicleId: VEHICLE_ID };
}

export default function () {
  const res = ws.connect(WS_URL, {}, (socket) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, vehicleId: VEHICLE_ID }));
      const interval = 1000 / Math.max(1, HZ);
      let lastSent = Date.now();
      socket.setInterval(() => {
        const now = Date.now();
        if (now - lastSent >= interval) {
          lastSent = now;
          socket.send(JSON.stringify({ type: 'input', payload: buildPayload(), vehicleId: VEHICLE_ID }));
        }
      }, 5);
    });

    socket.on('message', () => {});
    socket.on('close', () => {});
  });

  check(res, { 'status is 101': (r) => r && r.status === 101 });
  sleep(1);
}
