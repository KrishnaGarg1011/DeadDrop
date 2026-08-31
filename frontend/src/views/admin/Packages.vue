<script setup>
import { ref, onMounted, watch } from 'vue';
import { api } from '../../api/client.js';
import Pagination from '../../components/Pagination.vue';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const limit = ref(10);
const status = ref('');
const type = ref('');
const q = ref('');
const error = ref('');
const busy = ref(false);

const statusMap = {
  active: 'active', expired: 'expired', burned: 'burned', locked: 'locked', revoked: 'revoked',
};

async function load() {
  busy.value = true;
  error.value = '';
  const params = new URLSearchParams({ page: page.value, limit: limit.value });
  if (status.value) params.set('status', status.value);
  if (type.value) params.set('type', type.value);
  if (q.value) params.set('q', q.value);
  try {
    const data = await api.get(`/api/admin/packages?${params}`);
    list.value = data.list;
    total.value = data.total;
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function revoke(pkg) {
  if (!confirm(`Revoke package ${pkg.token.slice(0, 8)}… ?`)) return;
  try {
    await api.post(`/api/admin/packages/${pkg.token}/revoke`);
    await load();
  } catch (err) {
    alert(err.message);
  }
}

function resetFilters() {
  status.value = '';
  type.value = '';
  q.value = '';
  page.value = 1;
}

watch([status, type, q], () => { page.value = 1; load(); });
onMounted(load);
</script>

<template>
  <div>
    <h1>Packages</h1>
    <p class="muted">Search, filter and manage every package.</p>

    <div class="toolbar">
      <input v-model="q" placeholder="Search token / file name…" class="grow" />
      <select v-model="status">
        <option value="">Any status</option>
        <option v-for="(v, k) in statusMap" :value="k" :key="k">{{ v }}</option>
      </select>
      <select v-model="type">
        <option value="">Any type</option>
        <option value="text">Text</option>
        <option value="file">File</option>
      </select>
      <button class="ghost" @click="resetFilters">Reset</button>
    </div>

    <div v-if="error" class="alert error">{{ error }}</div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Token</th><th>Type</th><th>Views</th><th>Expires</th><th>Status</th><th>Created</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!busy && list.length === 0">
            <td colspan="7" class="center muted" style="padding: 30px">No packages found.</td>
          </tr>
          <tr v-for="p in list" :key="p.id">
            <td data-label="Token" class="mono">{{ p.token.slice(0, 12) }}…</td>
            <td data-label="Type"><span class="badge">{{ p.type }}</span></td>
            <td data-label="Views">{{ p.view_count }}{{ p.max_views ? ' / ' + p.max_views : '' }}</td>
            <td data-label="Expires" class="muted">{{ p.expires_at ? new Date(p.expires_at).toLocaleString() : '—' }}</td>
            <td data-label="Status"><span class="pill" :class="p.status">{{ p.status }}</span></td>
            <td data-label="Created" class="muted">{{ new Date(p.created_at).toLocaleString() }}</td>
            <td data-label="Actions">
              <button v-if="p.status === 'active'" class="danger" @click="revoke(p)">Revoke</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Pagination :page="page" :total="total" :limit="limit" @change="(p) => { page = p; load(); }" />
  </div>
</template>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.toolbar input { max-width: 340px; }
.toolbar select { width: auto; min-width: 140px; }
</style>
