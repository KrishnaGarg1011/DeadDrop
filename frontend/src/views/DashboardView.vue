<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { api } from '../api/client.js';
import { openRealtime } from '../api/realtime.js';
import Pagination from '../components/Pagination.vue';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const limit = ref(8);
const error = ref('');
const qrUrl = ref('');

// expanded row (recipient read-status)
const expanded = ref(null);
const expandedRecipients = ref([]);

// live notifications
const notifications = ref([]);
let ws = null;

const statusPill = (s) => s;

async function load() {
  error.value = '';
  try {
    const data = await api.get(`/api/packages/mine?page=${page.value}&limit=${limit.value}`);
    list.value = data.list;
    total.value = data.total;
  } catch (err) {
    error.value = err.message;
  }
}

function onEvent(ev) {
  notifications.value.unshift(ev);
  if (notifications.value.length > 5) notifications.value.pop();
  // refresh to reflect new view counts
  load();
}

async function toggleExpand(pkg) {
  if (expanded.value === pkg.token) {
    expanded.value = null;
    return;
  }
  expanded.value = pkg.token;
  try {
    const data = await api.get(`/api/packages/mine/${pkg.token}`);
    expandedRecipients.value = data.recipients || [];
  } catch (err) {
    expandedRecipients.value = [];
  }
}

async function revoke(pkg) {
  if (!confirm(`Revoke drop ${pkg.token.slice(0, 8)}…? Receivers will no longer open it.`)) return;
  try {
    await api.post(`/api/packages/mine/${pkg.token}/revoke`);
    await load();
  } catch (err) {
    alert(err.message);
  }
}

async function copyLink(pkg) {
  const url = `${location.origin}/v/${pkg.token}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const el = document.createElement('textarea');
    el.value = url; document.body.appendChild(el); el.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(el);
  }
  notifications.value.unshift({ type: 'copied', token: pkg.token });
}

function timeLeft(pkg) {
  if (!pkg.expires_at) return '';
  const diff = new Date(pkg.expires_at) - Date.now();
  if (diff <= 0) return 'expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const counters = computed(() => {
  const active = list.value.filter((p) => p.status === 'active').length;
  const burned = list.value.filter((p) => p.status === 'burned').length;
  const totalViews = list.value.reduce((a, p) => a + (p.view_count || 0), 0);
  return { active, burned, totalViews };
});

onMounted(() => {
  load();
  ws = openRealtime(onEvent);
});
onUnmounted(() => { if (ws) ws.close(); });
</script>

<template>
  <div>
    <h1>Your drops</h1>
    <p class="muted">Track, copy and revoke everything you've sent. Opens appear live.</p>

    <div class="statbar">
      <div class="mini"><div class="v">{{ counters.active }}</div><div class="l">Active</div></div>
      <div class="mini"><div class="v">{{ counters.burned }}</div><div class="l">Burned</div></div>
      <div class="mini"><div class="v">{{ counters.totalViews }}</div><div class="l">Total views</div></div>
    </div>

    <div v-if="error" class="alert error">{{ error }}</div>

    <!-- live notifications -->
    <transition-group v-if="notifications.length" name="toast" tag="div" class="live">
      <div v-for="(n, i) in notifications" :key="i" class="live-item">
        <template v-if="n.type === 'opened'">🔔 <b>Drop opened</b> · {{ n.token.slice(0, 8) }}… (view {{ n.views }})</template>
        <template v-else-if="n.type === 'burned'">🔥 <b>Burned after reading</b> · {{ n.token.slice(0, 8) }}…</template>
        <template v-else-if="n.type === 'exhausted'">⏱ <b>Hit view limit</b> · {{ n.token.slice(0, 8) }}…</template>
        <template v-else-if="n.type === 'copied'">✅ Link copied · {{ n.token.slice(0, 8) }}…</template>
      </div>
    </transition-group>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Token</th><th>Type</th><th>Views</th><th>Expires</th><th>Status</th><th>Created</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="list.length === 0"><td colspan="7" class="center muted" style="padding: 30px">Nothing here yet. <RouterLink to="/">Create a drop →</RouterLink></td></tr>
          <template v-for="p in list" :key="p.id">
            <tr>
              <td class="mono">{{ p.token.slice(0, 10) }}…</td>
              <td><span class="badge">{{ p.type }}</span></td>
              <td>{{ p.view_count }}{{ p.max_views ? ' / ' + p.max_views : '' }}</td>
              <td class="muted">{{ p.expires_at ? timeLeft(p) : 'never' }}</td>
              <td><span class="pill" :class="p.status">{{ p.status }}</span></td>
              <td class="muted">{{ new Date(p.created_at).toLocaleDateString() }}</td>
              <td style="white-space: nowrap">
                <button class="ghost" @click="copyLink(p)">Copy</button>
                <button class="ghost" @click="toggleExpand(p)">{{ expanded === p.token ? 'Hide' : 'Reads' }}</button>
                <button v-if="p.status === 'active'" class="danger" @click="revoke(p)">Revoke</button>
              </td>
            </tr>
            <tr v-if="expanded === p.token" class="expand">
              <td colspan="7">
                👥 <b>Recipients</b>
                <span v-if="expandedRecipients.length === 0" class="muted"> (not a shared drop)</span>
                <span v-else class="recips">
                  <span v-for="r in expandedRecipients" :key="r.id" class="recip">
                    {{ r.recipient_email }}
                    <span class="pill" :class="r.opened_at ? 'active' : 'expired'">{{ r.opened_at ? 'read' : 'pending' }}</span>
                  </span>
                </span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <Pagination :page="page" :total="total" :limit="limit" @change="(p) => { page = p; load(); }" />
  </div>
</template>

<style scoped>
.statbar { display: flex; gap: 14px; margin-bottom: 20px; }
.mini { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px; }
.mini .v { font-size: 1.4rem; font-weight: 800; }
.mini .l { color: var(--muted); font-size: 0.8rem; }
.live { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.live-item { background: var(--accent-dim); border: 1px solid rgba(52,211,153,.3); border-radius: 10px; padding: 10px 14px; font-size: 0.88rem; }
.recips { display: inline-flex; flex-direction: column; gap: 6px; margin-left: 8px; }
.recip { display: inline-flex; gap: 8px; align-items: center; }
.expand td { background: var(--panel-2); }
.toast-enter-active { animation: slidein .25s ease; }
@keyframes slidein { from { opacity: 0; transform: translateY(-6px);} to { opacity:1; transform:none;} }
h1 { margin-bottom: 4px; }
</style>
