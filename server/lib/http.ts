import type { IncomingMessage, ServerResponse } from 'node:http';
import { BODY_LIMIT_DEFAULT } from '../config.js';

const DEFAULT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, {
    ...DEFAULT_HEADERS,
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(payload));
}

export function sendText(res: ServerResponse, status: number, payload: string) {
  res.writeHead(status, {
    ...DEFAULT_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(payload);
}

export function parseBody<T>(
  req: IncomingMessage,
  maxBytes: number = BODY_LIMIT_DEFAULT
): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > maxBytes) {
        const error = new Error(`Payload too large (limit: ${maxBytes} bytes).`);
        (error as Error & { code?: string }).code = 'PAYLOAD_TOO_LARGE';
        reject(error);
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
