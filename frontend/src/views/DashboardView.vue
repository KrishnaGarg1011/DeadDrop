<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api/client.js';
import Pagination from '../components/Pagination.vue';
import { useAuthStore } from '../stores/auth.js';
import { getGuestId } from '../utils/guest.js';

const auth = useAuthStore();
const guestId = getGuestId();

// account holder sees their account drops; a guest sees this session's drops.
const isGuest = computed(() => !auth.isUser);
const prefix = computed(() =>
  isGuest.value ? `/api/packages/guest/${guestId}` : '/api/packages/mine'
);

const list = ref([]);
const total = ref(0);
const page = ref(1);
const limit = ref(8);
const error = ref('');

// expanded row: recipient read-status + event log
const expanded = ref(null);
const expandedRecipients = ref([]);
const expandedLog = ref([]);

function deliveryStatus(pkg) {
  if (pkg.status === 'burned') return { label: 'Seen & burned', cls: 'burned' };
  if (pkg.status === 'revoked') return { label: 'Revoked', cls: 'revoked' };
  if (pkg.status === 'locked') return { label: 'Locked', cls: 'locked' };
  if (pkg.status === 'expired' && pkg.max_views && pkg.view_count >= pkg.max_views) return { label: 'Seen (limit hit)', cls: 'expired' };
  if (pkg.status === 'expired') return { label: 'Expired', cls: 'expired' };
  if (pkg.view_count > 0) return { label: 'Seen', cls: 'active' };
  return { label: 'Sent', cls: 'active' };
}

async function load() {
  error.value = '';
  try {
    const data = await api.get(`${prefix.value}?page=${page.value}&limit=${limit.value}`);
    list.value = data.list;
    total.value = data.total;
  } catch (err) {
    error.value = err.message;
  }
}

async function toggleExpand(pkg) {
  if (expanded.value === pkg.token) { expanded.value = null; return; }
  expanded.value = pkg.token;
  try {
    const d = await api.get(`${prefix.value}/${pkg.token}`);
    expandedRecipients.value = d.recipients || [];
  } catch { expandedRecipients.value = []; }
  try {
    const l = await api.get(`${prefix.value}/${pkg.token}/log`);
    expandedLog.value = l.events || [];
  } catch { expandedLog.value = []; }
}

async function revoke(pkg) {
  if (!confirm(`Revoke drop ${pkg.token.slice(0, 8)}…?`)) return;
  // guests revoke via the public token route (the token is the credential)
  const url = isGuest.value ? `/api/packages/${pkg.token}/revoke` : `${prefix.value}/${pkg.token}/revoke`;
  try { await api.post(url); await load(); }
  catch (err) { alert(err.message); }
}

async function copyLink(pkg) {
  const url = `${location.origin}/v/${pkg.token}`;
  try { await navigator.clipboard.writeText(url); }
  catch {
    const el = document.createElement('textarea'); el.value = url; document.body.appendChild(el); el.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(el);
  }
}

function timeLeft(pkg) {
  if (!pkg.expires_at) return '';
  const diff = new Date(pkg.expires_at) - Date.now();
  if (diff <= 0) return 'expired';
  const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const counters = computed(() => ({
  active: list.value.filter((p) => p.status === 'active').length,
  burned: list.value.filter((p) => p.status === 'burned').length,
  totalViews: list.value.reduce((a, p) => a + (p.view_count || 0), 0),
}));

function logLabel(e) {
  const a = e.action || (e.success ? 'ok' : 'failed');
  const map = {
    'package.created': 'Sent', 'package.opened': 'Opened', 'package.burned': 'Burned',
    'package.locked': 'Locked', 'package.revoked': 'Revoked', 'package.expired': 'Expired',
    'package.exhausted': 'View limit hit', 'package.acknowledged': 'Acknowledged',
    'package.access_failed': 'Password failed',
  };
  let label = map[a] || a;
  if (e.kind === 'access' && !e.success) label = 'Failed attempt';
  return label;
}
function logColor(e) {
  const a = e.action || (e.success ? 'ok' : 'fail');
  if (a === 'package.burned' || a === 'package.revoked') return 'burned';
  if (a === 'package.locked') return 'locked';
  if (a === 'package.expired' || a === 'package.exhausted') return 'expired';
  if (e.kind === 'access' && !e.success) return 'locked';
  return 'active';
}

onMounted(load);
</script>

<template>
  <div>
    <h1>Your drops</h1>
    <p class="muted">Track the status, read receipts and full delivery log of everything you've sent. Opens appear on the 🔔 bell live.</p>

    <div v-if="isGuest" class="alert info guest-note">
      👤 <b>Guest session</b> — these drops are tied to this browser only. They stay until you clear your data.
      <RouterLink to="/register">Create an account</RouterLink> to keep them permanently.
    </div>

    <div class="statbar">
      <div class="mini"><div class="v">{{ counters.active }}</div><div class="l">Active</div></div>
      <div class="mini"><div class="v">{{ counters.burned }}</div><div class="l">Burned</div></div>
      <div class="mini"><div class="v">{{ counters.totalViews }}</div><div class="l">Total views</div></div>
    </div>

    <div v-if="error" class="alert error">{{ error }}</div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Token</th><th>Type</th><th>Views</th><th>Expires</th><th>Status</th><th>Delivered</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-if="list.length === 0"><td colspan="8" class="center muted" style="padding: 30px">Nothing yet. <RouterLink to="/">Create a drop →</RouterLink></td></tr>
          <template v-for="p in list" :key="p.id">
            <tr>
              <td data-label="Token" class="mono">{{ p.token.slice(0, 10) }}…</td>
              <td data-label="Type"><span class="badge">{{ p.type }}</span></td>
              <td data-label="Views">{{ p.view_count }}{{ p.max_views ? ' / ' + p.max_views : '' }}</td>
              <td data-label="Expires" class="muted">{{ p.expires_at ? timeLeft(p) : 'never' }}</td>
              <td data-label="Status"><span class="pill" :class="p.status">{{ p.status }}</span></td>
              <td data-label="Delivered">
                <span class="pill" :class="deliveryStatus(p).cls">{{ deliveryStatus(p).label }}</span>
              </td>
              <td data-label="Created" class="muted">{{ new Date(p.created_at).toLocaleDateString() }}</td>
              <td data-label="Actions" style="white-space: nowrap">
                <button class="ghost" @click="copyLink(p)">Copy</button>
                <button class="ghost" @click="toggleExpand(p)">{{ expanded === p.token ? 'Hide' : 'Details' }}</button>
                <button v-if="p.status === 'active'" class="danger" @click="revoke(p)">Revoke</button>
              </td>
            </tr>
            <tr v-if="expanded === p.token" class="expand">
              <td colspan="8" class="expand">
                <div class="detail-grid">
                  <div class="dcard">
                    <b>👥 Recipients</b>
                    <p v-if="expandedRecipients.length === 0" class="muted">Not a shared drop.</p>
                    <div v-for="r in expandedRecipients" :key="r.id" class="recip">
                      {{ r.recipient_email }}
                      <span class="pill" :class="r.opened_at ? 'active' : 'expired'">{{ r.opened_at ? (r.acknowledged_at ? 'seen ✓' : 'seen') : 'pending' }}</span>
                    </div>
                  </div>
                  <div class="dcard">
                    <b>📜 Delivery log</b>
                    <p v-if="expandedLog.length === 0" class="muted">No events yet.</p>
                    <div v-for="(e, i) in expandedLog" :key="i" class="logrow">
                      <span class="pill" :class="logColor(e)">{{ logLabel(e) }}</span>
                      <span class="muted">{{ new Date(e.created_at).toLocaleString() }}</span>
                    </div>
                  </div>
                </div>
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
.mini .v { font-size: 1.4rem; font-weight: 800; } .mini .l { color: var(--muted); font-size: 0.8rem; }
.expand td { background: var(--panel-2); }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.dcard { background: var(--bg-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.recip { display: flex; gap: 8px; align-items: center; margin: 6px 0; font-size: 0.88rem; }
.logrow { display: flex; gap: 10px; align-items: center; margin: 6px 0; font-size: 0.82rem; }
.guest-note { font-size: 0.9rem; }
h1 { margin-bottom: 4px; }
@media (max-width: 640px) { .detail-grid { grid-template-columns: 1fr; } }
</style>
