import http, { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 5000);
const GATEWAY_PROXY_UI = process.env.GATEWAY_PROXY_UI === '1';

const API_HOST = process.env.GATEWAY_API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.GATEWAY_API_PORT || 3100);

const WS_HOST = process.env.GATEWAY_WS_HOST || '127.0.0.1';
const WS_CONTROL_PORT = Number(process.env.GATEWAY_WS_CONTROL_PORT || 3000);
const WS_TELEMETRY_PORT = Number(process.env.GATEWAY_WS_TELEMETRY_PORT || 3001);
const WS_DEVICE_PORT = Number(process.env.GATEWAY_WS_DEVICE_PORT || 4000);

const VITE_HOST = process.env.GATEWAY_VITE_HOST || '127.0.0.1';
const VITE_PORT = Number(process.env.GATEWAY_VITE_PORT || 5173);
const VITE_HTTP_ORIGIN = process.env.GATEWAY_VITE_URL || `http://${VITE_HOST}:${VITE_PORT}`;
const VITE_WS_ORIGIN = process.env.GATEWAY_VITE_WS_URL || `ws://${VITE_HOST}:${VITE_PORT}`;

const DIST_DIR = path.resolve(process.cwd(), 'dist');

function contentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function proxyHttp(req: IncomingMessage, res: ServerResponse, targetOrigin: string) {
  const targetUrl = new URL(req.url || '/', targetOrigin);
  const options: http.RequestOptions = {
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.host,
    },
  };

  const proxyReq = http.request(targetUrl, options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (error) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Gateway proxy error: ${error.message}`);
  });

  req.pipe(proxyReq);
}

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0] || '/');
  const cleaned = urlPath.replace(/\\/g, '/');
  const safePath = cleaned.startsWith('/') ? cleaned.slice(1) : cleaned;
  const filePath = safePath ? path.join(DIST_DIR, safePath) : path.join(DIST_DIR, 'index.html');

  const candidate = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(DIST_DIR, 'index.html');

  fs.readFile(candidate, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(candidate) });
    res.end(data);
  });
}

function resolveWsTarget(pathname: string) {
  if (pathname.startsWith('/ws/control')) {
    return `ws://${WS_HOST}:${WS_CONTROL_PORT}${pathname}`;
  }
  if (pathname.startsWith('/ws/telemetry')) {
    return `ws://${WS_HOST}:${WS_TELEMETRY_PORT}${pathname}`;
  }
  if (pathname.startsWith('/ws/device')) {
    return `ws://${WS_HOST}:${WS_DEVICE_PORT}${pathname}`;
  }
  return null;
}

function proxyWebSocket(client: WebSocket, targetUrl: string, request: IncomingMessage) {
  const upstream = new WebSocket(targetUrl, {
    perMessageDeflate: false,
    headers: {
      cookie: request.headers.cookie || '',
    },
  });

  const closeBoth = () => {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close();
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  };

  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    }
  });
  client.on('ping', (data) => {
    // Always acknowledge to keep device WS alive.
    if (client.readyState === WebSocket.OPEN) {
      client.pong(data);
    }
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.ping(data);
    }
  });
  client.on('pong', (data) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.pong(data);
    }
  });
  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });
  upstream.on('ping', (data) => {
    // Always acknowledge upstream pings to keep tunnel alive.
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.pong(data);
    }
    if (client.readyState === WebSocket.OPEN) {
      client.ping(data);
    }
  });
  upstream.on('pong', (data) => {
    if (client.readyState === WebSocket.OPEN) {
      client.pong(data);
    }
  });

  client.on('error', closeBoth);
  upstream.on('error', closeBoth);
  client.on('close', closeBoth);
  upstream.on('close', closeBoth);
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0] || '/';

  if (pathname.startsWith('/api') || pathname.startsWith('/health') || pathname.startsWith('/metrics')) {
    proxyHttp(req, res, `http://${API_HOST}:${API_PORT}`);
    return;
  }

  if (pathname.startsWith('/ws/')) {
    res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Upgrade required');
    return;
  }

  if (GATEWAY_PROXY_UI) {
    proxyHttp(req, res, VITE_HTTP_ORIGIN);
    return;
  }

  serveStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '/').split('?')[0] || '/';
  const wsTarget = resolveWsTarget(pathname);
  const targetUrl = wsTarget || (GATEWAY_PROXY_UI ? `${VITE_WS_ORIGIN}${pathname}` : null);

  if (!targetUrl) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (client) => {
    proxyWebSocket(client, targetUrl, req);
  });
});

server.listen(GATEWAY_PORT, () => {
  const uiMode = GATEWAY_PROXY_UI ? `proxy -> ${VITE_HTTP_ORIGIN}` : `static -> ${DIST_DIR}`;
  // eslint-disable-next-line no-console
  console.log(`Gateway listening on http://0.0.0.0:${GATEWAY_PORT} (${uiMode})`);
});
