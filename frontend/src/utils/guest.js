import { api } from '../api/client.js';

// A per-browser "guest session" id lets anonymous (not-logged-in) senders see
// the same tracking/logging features as account holders — for this session only.
// It is a long random value, so it is not guessable and acts as the credential.

const ID_KEY = 'deaddrop_guest_id';

function randomId() {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
    // eslint-disable-next-line no-unused-vars
    const c = crypto.getRandomValues(new Uint32Array(4));
    return `${Date.now().toString(36)}-${Array.from(c, (n) => n.toString(36)).join('')}`;
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 16)}`;
  }
}

export function getGuestId() {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

// The backend signs a short-lived JWT so the guest can open the realtime
// channel (role 'guest'), same as a logged-in sender does.
export async function getGuestToken() {
  const guestId = getGuestId();
  if (!guestId) return null;
  try {
    const data = await api.post('/api/packages/guest/session', { guestId });
    return data.token || null;
  } catch {
    return null;
  }
}
