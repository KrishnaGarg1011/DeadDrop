<script setup>
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth.js';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const showTopbar = () => route.name !== 'receive';

function onLogout() {
  auth.logout();
  router.push('/');
}
</script>

<template>
  <div class="app">
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
        <RouterLink v-if="auth.isAdmin" to="/admin" class="adminbtn">Admin</RouterLink>
        <RouterLink v-else to="/login?admin=1" class="adminbtn">Admin</RouterLink>

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
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 34px;
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.2rem; color: var(--text); letter-spacing: -0.01em; }
.brand:hover { text-decoration: none; }
.logo {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 8px;
  background: var(--accent-strong);
}
.nav { display: flex; align-items: center; gap: 14px; font-size: 0.9rem; }
.who { font-size: 0.85rem; }
.adminbtn {
  border: 1px solid var(--border-2); background: var(--bg-2);
  color: var(--text); padding: 8px 18px; border-radius: 10px; font-weight: 600;
}
.adminbtn:hover { border-color: var(--accent-strong); text-decoration: none; }
.main { flex: 1; width: 100%; max-width: 1150px; margin: 0 auto; padding: 10px 24px 60px; }
</style>
