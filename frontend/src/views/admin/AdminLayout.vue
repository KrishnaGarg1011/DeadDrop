<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();

function logout() {
  auth.logout();
  router.push('/');
}
</script>

<template>
  <div class="admin">
    <aside class="side">
      <div class="side-brand">◈ DeadDrop <span class="badge">Admin</span></div>
      <nav>
        <RouterLink to="/admin" exact-active-class="on">Overview</RouterLink>
        <RouterLink to="/admin/packages" active-class="on">Packages</RouterLink>
        <RouterLink to="/admin/users" active-class="on">Users</RouterLink>
        <RouterLink to="/admin/failed" active-class="on">Failed Attempts</RouterLink>
        <RouterLink to="/admin/audit" active-class="on">Audit Log</RouterLink>
      </nav>
      <div class="side-bottom">
        <span class="muted">{{ auth.identity?.username || 'admin' }}</span>
        <button class="ghost" @click="logout">Log out</button>
      </div>
    </aside>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.admin { display: grid; grid-template-columns: 220px 1fr; gap: 24px; min-height: 100%; }
.side {
  position: sticky; top: 20px; align-self: start;
  display: flex; flex-direction: column; gap: 18px;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 20px; height: calc(100vh - 40px);
}
.side-brand { font-weight: 700; font-size: 1.05rem; display: flex; align-items: center; gap: 8px; }
.side nav { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.side nav a { color: var(--muted); padding: 9px 12px; border-radius: 9px; }
.side nav a:hover { color: var(--text); text-decoration: none; background: var(--panel-2); }
.side nav a.on { color: #fff; background: var(--accent); }
.side-bottom { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 14px; }
.content { min-width: 0; }
@media (max-width: 760px) {
  .admin { grid-template-columns: 1fr; gap: 14px; }
  .side { position: static; height: auto; flex-direction: row; align-items: center; padding: 12px 14px; }
  .side-brand { white-space: nowrap; }
  .side nav { flex-direction: row; flex-wrap: wrap; gap: 4px; }
  .side nav a { padding: 6px 10px; font-size: 0.8rem; }
  .side-bottom { border-top: none; padding-top: 0; flex-direction: row; align-items: center; gap: 10px; }
  .content { padding-bottom: 24px; }
}
</style>
