// Thin fetch wrapper around the Express API. Attaches the stored JWT when
// present and normalizes errors for consistent UI handling.

const tokenKey = 'deaddrop_token';
const roleKey = 'deaddrop_role';

// In dev, Vite proxies /api → the local Express server (no CORS).
// In production, point this at the hosted backend, e.g.
//   VITE_API_BASE=https://your-api.up.railway.app
export const API_BASE = import.meta.env.VITE_API_BASE || '';


// Storage access can throw (sandboxed iframe, private mode, blocked cookies),
// so guard every call — the app must never crash because storage is unavailable.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export function getToken() {
  return store.get(tokenKey);
}
export function getRole() {
  return store.get(roleKey);
}
export function setSession(token, role) {
  store.set(tokenKey, token);
  store.set(roleKey, role);
}
export function clearSession() {
  store.del(tokenKey);
  store.del(roleKey);
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, url, { body, headers = {}, isForm = false } = {}) {
  const token = getToken();
  const options = { method, headers: { ...headers } };
  if (token) options.headers.Authorization = `Bearer ${token}`;

  if (body != null) {
    if (isForm) {
      options.body = body; // FormData — browser sets the boundary
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }

  const res = await fetch(`${API_BASE}${url}`, options);

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : {};

  if (!res.ok) {
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, { body }),
  postForm: (url, formData) => request('POST', url, { body: formData, isForm: true }),
};
