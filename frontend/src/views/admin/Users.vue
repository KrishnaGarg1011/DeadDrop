<script setup>
import { ref, onMounted, watch } from 'vue';
import { api } from '../../api/client.js';
import Pagination from '../../components/Pagination.vue';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const limit = ref(10);
const q = ref('');
const error = ref('');

async function load() {
  const params = new URLSearchParams({ page: page.value, limit: limit.value });
  if (q.value) params.set('q', q.value);
  try {
    const data = await api.get(`/api/admin/users?${params}`);
    list.value = data.list;
    total.value = data.total;
  } catch (err) {
    error.value = err.message;
  }
}
watch(q, () => { page.value = 1; load(); });
onMounted(load);
</script>

<template>
  <div>
    <h1>Users</h1>
    <p class="muted">Registered sender accounts.</p>
    <div class="toolbar">
      <input v-model="q" placeholder="Search by email…" class="grow" />
    </div>
    <div v-if="error" class="alert error">{{ error }}</div>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Email</th><th>Packages</th><th>Joined</th></tr></thead>
        <tbody>
          <tr v-if="list.length === 0"><td colspan="3" class="center muted" style="padding: 30px">No users found.</td></tr>
          <tr v-for="u in list" :key="u.id">
            <td>{{ u.email }}</td>
            <td>{{ u.package_count }}</td>
            <td class="muted">{{ new Date(u.created_at).toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <Pagination :page="page" :total="total" :limit="limit" @change="(p) => { page = p; load(); }" />
  </div>
</template>

<style scoped>
.toolbar { display: flex; margin-bottom: 18px; }
.toolbar input { max-width: 340px; }
</style>
