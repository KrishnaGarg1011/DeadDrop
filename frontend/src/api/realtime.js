import { API_BASE, getToken } from './client.js';

// Open a WebSocket to the backend's /ws endpoint (JWT via query param).
// In dev, Vite proxies /ws to the Express server; in production it connects
// straight to the hosted backend. `token` defaults to the stored account JWT
// but may also be a guest-session token (role 'guest').
export function openRealtime(onEvent, tokenArg) {
  const token = tokenArg || getToken();
  if (!token) return null;

  let base = API_BASE;
  if (!base) {
    base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  }
  const wsBase = base.replace(/^http/, 'ws');
  let ws;
  try {
    ws = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);
  } catch {
    return null;
  }

  ws.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'package_event') onEvent && onEvent(d.event);
    } catch {}
  };

  // Keep-alive
  const ping = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
  }, 25000);

  ws.onclose = () => clearInterval(ping);
  return ws;
}
