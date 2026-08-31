import { defineStore } from 'pinia';
import { openRealtime } from '../api/realtime.js';

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    items: [],            // { id, action, token, recipient, views, at }
    unread: 0,
    open: false,
    ws: null,
    connected: false,
  }),
  actions: {
    connect() {
      if (this.ws) return;
      this.ws = openRealtime((event) => {
        this.items.unshift({ id: `${Date.now()}-${Math.random()}`, ...event });
        if (this.items.length > 30) this.items.pop();
        this.unread += 1;
      });
      this.connected = !!this.ws;
    },
    disconnect() {
      if (this.ws) { this.ws.close(); this.ws = null; this.connected = false; }
    },
    markRead() { this.unread = 0; },
    toggle() { this.open = !this.open; if (!this.open) this.markRead(); },
  },
});
