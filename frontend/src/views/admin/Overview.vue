<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../../api/client.js';

const stats = ref(null);
const error = ref('');

async function load() {
  try {
    const data = await api.get('/api/admin/stats');
    stats.value = data.stats;
  } catch (err) {
    error.value = err.message;
  }
}
onMounted(load);
</script>

<template>
  <div>
    <h1>Overview</h1>
    <p class="muted">Platform health at a glance.</p>
    <div v-if="error" class="alert error">{{ error }}</div>

    <div v-if="stats" class="grid">
      <div class="stat"><div class="v">{{ stats.total_packages }}</div><div class="l">Total packages</div></div>
      <div class="stat"><div class="v" style="color: var(--green)">{{ stats.active_packages }}</div><div class="l">Active</div></div>
      <div class="stat"><div class="v" style="color: var(--amber)">{{ stats.expired_packages }}</div><div class="l">Expired</div></div>
      <div class="stat"><div class="v" style="color: var(--red)">{{ stats.burned_packages }}</div><div class="l">Burned</div></div>
      <div class="stat"><div class="v" style="color: var(--red)">{{ stats.locked_packages }}</div><div class="l">Locked</div></div>
      <div class="stat"><div class="v">{{ stats.revoked_packages }}</div><div class="l">Revoked</div></div>
      <div class="stat"><div class="v">{{ stats.total_users }}</div><div class="l">Users</div></div>
      <div class="stat"><div class="v">{{ stats.total_views }}</div><div class="l">Total views</div></div>
      <div class="stat"><div class="v" style="color: var(--red)">{{ stats.failed_accesses }}</div><div class="l">Failed accesses</div></div>
      <div class="stat"><div class="v" style="color: var(--red)">{{ stats.failed_logins }}</div><div class="l">Failed logins</div></div>
      <div class="stat wide"><div class="v">{{ (stats.stored_bytes / 1024).toFixed(1) }} KB</div><div class="l">Bytes stored on disk</div></div>
    </div>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
.stat { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
.stat .v { font-size: 1.8rem; font-weight: 800; }
.stat .l { color: var(--muted); font-size: 0.85rem; margin-top: 4px; }
.stat.wide { grid-column: span 2; }
h1 { margin-bottom: 4px; }
</style>
