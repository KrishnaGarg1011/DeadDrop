// Real-time package events using PostgreSQL LISTEN/NOTIFY + a WebSocket
// endpoint. When a package is opened/burned, the backend publishes a
// notification on the 'package_events' channel; this service relays it over
// WebSocket to the sender's open connections.
import { WebSocketServer } from 'ws';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../config/db.js';

const CHANNEL = 'package_events';

// Broadcast an event to the WebSocket connections owned by `creatorId`.
export async function notifyPackageEvent(event) {
  try {
    await query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(event)]);
  } catch (err) {
    console.error('[realtime] notify failed', err.message);
  }
}

export function attachRealtime(server) {
  // noServer: we handle the upgrade handshake ourselves so only /ws is accepted.
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  // Map of userId -> Set<ws>
  const rooms = new Map();
  const subscribe = (userId, ws) => {
    if (!rooms.has(userId)) rooms.set(userId, new Set());
    rooms.get(userId).add(ws);
  };
  const unsubscribe = (userId, ws) => {
    const set = rooms.get(userId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) rooms.delete(userId);
    }
  };

  wss.on('connection', (ws, req) => {
    // Authenticate via ?token=<jwt> (WebSocket can't send Authorization headers).
    let userId = null;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      const payload = jwt.verify(token, env.jwtSecret);
      if (payload.role !== 'user') throw new Error('not a user');
      userId = payload.sub;
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'unauthorized' }));
      ws.close(4401, 'unauthorized');
      return;
    }
    subscribe(userId, ws);
    ws.on('close', () => unsubscribe(userId, ws));
    ws.on('message', (msg) => {
      try {
        const d = JSON.parse(msg.toString());
        if (d.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch {}
    });
  });

  // A dedicated Postgres client listens on the channel.
  const listener = new pg.Client({ connectionString: env.databaseUrl });
  listener.on('error', (err) => console.error('[realtime] listener error', err.message));
  listener
    .connect()
    .then(async () => {
      await listener.query(`LISTEN ${CHANNEL}`);
      console.log('[realtime] listening on package_events');
    })
    .catch((err) => console.error('[realtime] listener connect failed', err.message));

  listener.on('notification', (msg) => {
    try {
      const event = JSON.parse(msg.payload);
      const { creatorId } = event;
      const sockets = rooms.get(String(creatorId));
      if (!sockets) return;
      const frame = JSON.stringify({ type: 'package_event', event });
      for (const ws of sockets) {
        if (ws.readyState === ws.OPEN) ws.send(frame);
      }
    } catch (err) {
      console.error('[realtime] bad notification', err.message);
    }
  });

  return wss;
}
