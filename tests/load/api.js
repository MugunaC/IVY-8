import http from 'k6/http';
import { check, sleep } from 'k6';

const API_URL = __ENV.API_URL || 'http://localhost:3100';
const VEHICLE_ID = __ENV.VEHICLE_ID || 'VH-001';

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '30s',
};

export default function () {
  const payload = {
    ts: Date.now(),
    vehicleId: VEHICLE_ID,
    payload: {
      buttons: Array(18).fill(0),
      axes: Array(4).fill(0),
      vehicleId: VEHICLE_ID,
    },
    bytes: 0,
  };
  const res = http.post(`${API_URL}/api/input`, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'status 2xx/429': (r) => r.status === 201 || r.status === 429 });
  sleep(0.1);
}
