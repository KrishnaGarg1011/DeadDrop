import { defineStore } from 'pinia';
import { api, getToken, getRole, setSession, clearSession } from '../api/client.js';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: getToken(),
    role: getRole(), // 'user' | 'admin' | null
    identity: null,
  }),

  getters: {
    isAuthenticated: (s) => !!s.token,
    isAdmin: (s) => s.role === 'admin',
    isUser: (s) => s.role === 'user',
  },

  actions: {
    set(token, role, identity = null) {
      this.token = token;
      this.role = role;
      this.identity = identity;
      setSession(token, role);
      if (identity) {
        try { localStorage.setItem('deaddrop_identity', JSON.stringify(identity)); } catch {}
      }
    },

    async restore() {
      if (!this.token) return;
      try {
        const me = await api.get('/api/auth/me');
        this.identity = me;
      } catch {
        /* stale token — ignore */
      }
    },

    async login(email, password) {
      const data = await api.post('/api/auth/login', { email, password });
      this.set(data.token, 'user', data.user);
    },

    async register(email, password) {
      const data = await api.post('/api/auth/register', { email, password });
      this.set(data.token, 'user', data.user);
    },

    async adminLogin(username, password) {
      const data = await api.post('/api/auth/admin/login', { username, password });
      this.set(data.token, 'admin', data.admin);
    },

    logout() {
      this.token = null;
      this.role = null;
      this.identity = null;
      clearSession();
      try { localStorage.removeItem('deaddrop_identity'); } catch {}
    },
  },
});
