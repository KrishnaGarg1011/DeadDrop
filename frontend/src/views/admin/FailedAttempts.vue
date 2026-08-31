<script setup>
import { ref, onMounted, watch } from 'vue';
import { api } from '../../api/client.js';
import Pagination from '../../components/Pagination.vue';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const limit = ref(10);
const kind = ref('');       // '' = both, 'access', 'login'
const error = ref('');

async function load() {
  const params = new URLSearchParams({ page: page.value, limit: limit.value });
  if (kind.value) params.set('kind', kind.value);
  try {
    const data = await api.get(`/api/admin/failed-attempts?${params}`);
    list.value = data.list;
    total.value = data.total;
  } catch (err) {
    error.value = err.message;
  }
}
watch(kind, () => { page.value = 1; load(); });
onMounted(load);
</script>

<template>
  <div>
    <h1>Failed Attempts</h1>
    <p class="muted">Failed unlocks and failed logins across the platform.</p>

    <div class="seg">
      <button :class="{ active: kind === '' }" @click="kind = ''">All</button>
      <button :class="{ active: kind === 'access' }" @click="kind = 'access'">Package access</button>
      <button :class="{ active: kind === 'login' }" @click="kind = 'login'">Logins</button>
    </div>

    <div v-if="error" class="alert error">{{ error }}</div>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Kind</th><th>Subject</th><th>Reason</th><th>IP</th><th>Time</th></tr></thead>
        <tbody>
          <tr v-if="list.length === 0"><td colspan="5" class="center muted" style="padding: 30px">No failed attempts.</td></tr>
          <tr v-for="a in list" :key="a.id">
            <td data-label="Kind"><span class="badge">{{ a.type }}</span></td>
            <td data-label="Subject" class="mono">{{ a.type === 'access' ? a.token?.slice(0, 14) : a.email }}</td>
            <td data-label="Reason">{{ a.detail }}</td>
            <td data-label="IP" class="muted">{{ a.ip_address }}</td>
            <td data-label="Time" class="muted">{{ new Date(a.created_at).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <Pagination :page="page" :total="total" :limit="limit" @change="(p) => { page = p; load(); }" />
  </div>
</template>

<style scoped>
.seg { display: inline-flex; gap: 4px; background: var(--panel-2); padding: 4px; border-radius: 11px; border: 1px solid var(--border); margin-bottom: 18px; }
.seg button { border: none; background: transparent; color: var(--muted); border-radius: 8px; font-weight: 600; padding: 7px 16px; }
.seg button.active { background: var(--accent); color: #fff; }
</style>
