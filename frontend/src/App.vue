<script setup>
import { onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth.js';
import { useNotificationsStore } from './stores/notifications.js';
import { theme, toggleTheme } from './composables/useTheme.js';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const notif = useNotificationsStore();

function showTopbar() { return route.name !== 'receive'; }
function onLogout() { auth.logout(); router.push('/'); }

const eventLabel = (a) =>
  a === 'opened' ? 'Drop opened'
  : a === 'burned' ? 'Burned after reading'
  : a === 'acknowledged' ? 'Recipient acknowledged'
  : a === 'exhausted' ? 'Hit view limit'
  : a;

// Connect realtime for both account holders and guest sessions. When the auth
// state flips (guest ↔ user), drop the old socket and reconnect with the new
// identity so events keep flowing.
watch(() => auth.isAuthenticated, () => { notif.disconnect(); notif.connect(); });
onMounted(() => notif.connect());
</script>

<template>
  <div class="app" :data-theme="theme">
    <header v-if="showTopbar()" class="topbar">
      <RouterLink to="/" class="brand">
        <span class="logo">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" stroke="#0a0d0c" stroke-width="1.6" fill="#0a0d0c"/>
            <path d="M9 13l2 2 4-4" stroke="#34d399" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        DeadDrop
      </RouterLink>

      <nav class="nav">
        <RouterLink to="/retrieve" class="navlink">Retrieve</RouterLink>
        <RouterLink v-if="!auth.isAdmin" to="/dashboard" class="navlink">My drops</RouterLink>
        <RouterLink v-if="auth.isAdmin" to="/admin" class="adminbtn">Admin</RouterLink>
        <RouterLink v-if="!auth.isAdmin" to="/login?admin=1" class="adminbtn">Admin</RouterLink>

        <button class="ghost theme-btn" @click="toggleTheme" :title="theme === 'light' ? 'Dark mode' : 'Light mode'">
          {{ theme === 'light' ? '🌙' : '☀️' }}
        </button>

        <!-- real-time notification bell (account holders AND guest sessions) -->
        <div class="bell-wrap">
          <button class="ghost bell" @click="notif.toggle()" title="Notifications">
            🔔
            <span v-if="notif.unread" class="badge-count">{{ notif.unread > 9 ? '9+' : notif.unread }}</span>
          </button>
          <transition name="drop">
            <div v-if="notif.open" class="notif-panel">
              <div class="np-head">Live activity</div>
              <div v-if="notif.items.length === 0" class="np-empty muted">No events yet. Open a drop link while this is open to see it here live.</div>
              <div v-for="n in notif.items" :key="n.id" class="np-item">
                <span class="np-icon">{{ n.action === 'burned' ? '🔥' : n.action === 'acknowledged' ? '✅' : n.action === 'exhausted' ? '⏱' : '🔔' }}</span>
                <div>
                  <div class="np-text">{{ eventLabel(n.action) }}</div>
                  <div class="np-meta muted">{{ n.token?.slice(0, 8) }}… · {{ new Date(n.at).toLocaleTimeString() }}</div>
                  <div v-if="n.recipient" class="np-meta muted">👤 {{ n.recipient }}</div>
                </div>
              </div>
            </div>
          </transition>
        </div>

        <template v-if="auth.isAuthenticated">
          <span class="muted who">{{ auth.isAdmin ? auth.identity?.username : auth.identity?.email }}</span>
          <button class="ghost" @click="onLogout">Log out</button>
        </template>
      </nav>
    </header>

    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app { min-height: 100%; display: flex; flex-direction: column; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 16px 34px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.2rem; color: var(--text); letter-spacing: -0.01em; }
.brand:hover { text-decoration: none; }
.logo { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; background: var(--accent-strong); }
.nav { display: flex; align-items: center; gap: 12px; font-size: 0.9rem; }
.who { font-size: 0.85rem; }
.navlink { color: var(--muted); }
.adminbtn { border: 1px solid var(--border-2); background: var(--bg-2); color: var(--text); padding: 8px 18px; border-radius: 10px; font-weight: 600; }
.adminbtn:hover { border-color: var(--accent-strong); text-decoration: none; }
.theme-btn { padding: 8px 10px; font-size: 1rem; }

.bell-wrap { position: relative; }
.bell { padding: 8px 10px; position: relative; font-size: 1.05rem; }
.badge-count { position: absolute; top: -2px; right: -2px; background: var(--red); color: #fff; font-size: 0.66rem; font-weight: 700; border-radius: 999px; padding: 1px 6px; min-width: 16px; text-align: center; }
.notif-panel { position: absolute; right: 0; top: 42px; width: 300px; max-height: 380px; overflow: auto; background: var(--bg-2); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); z-index: 60; padding: 6px; }
.np-head { font-weight: 700; font-size: 0.85rem; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.np-empty { padding: 18px 12px; font-size: 0.85rem; }
.np-item { display: flex; gap: 10px; padding: 10px 12px; border-radius: 8px; }
.np-item:hover { background: var(--accent-dim); }
.np-icon { font-size: 1rem; }
.np-text { font-size: 0.88rem; }
.np-meta { font-size: 0.75rem; }

.drop-enter-active, .drop-leave-active { transition: opacity 0.15s, transform 0.15s; }
.drop-enter-from, .drop-leave-to { opacity: 0; transform: translateY(-6px); }
.main { flex: 1; width: 100%; max-width: 1150px; margin: 0 auto; padding: 10px 24px 60px; }
</style>
