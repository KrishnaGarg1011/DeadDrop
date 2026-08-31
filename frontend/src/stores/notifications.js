import { defineStore } from 'pinia';
import { openRealtime } from '../api/realtime.js';
import { useAuthStore } from './auth.js';
import { getGuestToken } from '../utils/guest.js';

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    items: [],            // { id, action, token, recipient, views, at }
    unread: 0,
    open: false,
    ws: null,
    connected: false,
    mode: null,           // 'user' | 'guest' | null
  }),
  actions: {
    async connect() {
      if (this.ws) return;
      const auth = useAuthStore();
      // Logged-in account first; otherwise fall back to the guest session.
      let token = auth.token;
      let mode = auth.isAuthenticated ? 'user' : 'guest';
      if (!token) token = await getGuestToken();
      if (!token) { this.mode = null; return; }
      this.mode = mode;
      this.ws = openRealtime((event) => {
        this.items.unshift({ id: `${Date.now()}-${Math.random()}`, ...event });
        if (this.items.length > 30) this.items.pop();
        this.unread += 1;
      }, token);
      this.connected = !!this.ws;
    },
    disconnect() {
      if (this.ws) { this.ws.close(); this.ws = null; }
      this.connected = false;
      this.mode = null;
    },
    markRead() { this.unread = 0; },
    toggle() { this.open = !this.open; if (!this.open) this.markRead(); },
  },
});
