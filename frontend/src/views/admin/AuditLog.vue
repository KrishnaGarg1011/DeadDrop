<script setup>
import { ref, onMounted, watch } from 'vue';
import { api } from '../../api/client.js';
import Pagination from '../../components/Pagination.vue';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const limit = ref(15);
const action = ref('');
const actorType = ref('');
const entityType = ref('');
const q = ref('');
const error = ref('');
const selected = ref(null);

const actorOptions = ['user', 'admin', 'system', 'anonymous'];
const entityOptions = ['package', 'user', 'admin'];

async function load() {
  const params = new URLSearchParams({ page: page.value, limit: limit.value });
  if (action.value) params.set('action', action.value);
  if (actorType.value) params.set('actorType', actorType.value);
  if (entityType.value) params.set('entityType', entityType.value);
  if (q.value) params.set('q', q.value);
  try {
    const data = await api.get(`/api/admin/audit-logs?${params}`);
    list.value = data.list;
    total.value = data.total;
  } catch (err) {
    error.value = err.message;
  }
}

function resetFilters() {
  action.value = '';
  actorType.value = '';
  entityType.value = '';
  q.value = '';
  page.value = 1;
}
watch([action, actorType, entityType, q], () => { page.value = 1; load(); });
onMounted(load);
</script>

<template>
  <div>
    <h1>Audit Log</h1>
    <p class="muted">Every event, state change, timestamp and IP across the platform.</p>

    <div class="toolbar">
      <input v-model="q" placeholder="Search action or details…" class="grow" />
      <input v-model="action" placeholder="Filter action e.g. package.*" />
      <select v-model="actorType">
        <option value="">Any actor</option>
        <option v-for="a in actorOptions" :key="a" :value="a">{{ a }}</option>
      </select>
      <select v-model="entityType">
        <option value="">Any entity</option>
        <option v-for="e in entityOptions" :key="e" :value="e">{{ e }}</option>
      </select>
      <button class="ghost" @click="resetFilters">Reset</button>
    </div>

    <div v-if="error" class="alert error">{{ error }}</div>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Action</th><th>Actor</th><th>Entity</th><th>IP</th><th>Time</th><th></th></tr></thead>
        <tbody>
          <tr v-if="list.length === 0"><td colspan="6" class="center muted" style="padding: 30px">No audit entries.</td></tr>
          <tr v-for="l in list" :key="l.id" @click="selected = l" style="cursor: pointer">
            <td class="mono">{{ l.action }}</td>
            <td>{{ l.actor_type }}<span v-if="l.actor_id"> #{{ l.actor_id }}</span></td>
            <td class="muted">{{ l.entity_type || '—' }}<span v-if="l.entity_id"> #{{ l.entity_id }}</span></td>
            <td class="muted">{{ l.ip_address || '—' }}</td>
            <td class="muted">{{ new Date(l.created_at).toLocaleString() }}</td>
            <td><span class="muted">›</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <Pagination :page="page" :total="total" :limit="limit" @change="(p) => { page = p; load(); }" />

    <div v-if="selected" class="detail" @click.self="selected = null">
      <div class="card">
        <button class="ghost" style="float: right" @click="selected = null">✕</button>
        <h3>{{ selected.action }}</h3>
        <dl>
          <dt>Actor</dt><dd>{{ selected.actor_type }} (id {{ selected.actor_id }})</dd>
          <dt>Entity</dt><dd>{{ selected.entity_type }} #{{ selected.entity_id }}</dd>
          <dt>IP</dt><dd>{{ selected.ip_address || '—' }}</dd>
          <dt>User agent</dt><dd>{{ selected.user_agent || '—' }}</dd>
          <dt>Time</dt><dd>{{ new Date(selected.created_at).toLocaleString() }}</dd>
          <dt>Details</dt><dd><pre class="mono">{{ JSON.stringify(selected.details, null, 2) }}</pre></dd>
        </dl>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.toolbar input { max-width: 220px; }
.toolbar .grow { max-width: 280px; }
.toolbar select { width: auto; min-width: 130px; }
.detail { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.detail .card { max-width: 520px; width: 100%; }
dt { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 12px; }
dd { margin: 2px 0 0; }
pre { background: #0e1424; border: 1px solid var(--border); border-radius: 8px; padding: 10px; overflow: auto; }
</style>
