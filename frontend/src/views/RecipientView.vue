<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api, API_BASE } from '../api/client.js';
import { decryptText } from '../utils/crypto.js';

const route = useRoute();
const token = route.params.token;

const phase = ref('loading'); // loading | password | ready | error
const errorMessage = ref('');
const password = ref('');
const sharedEmail = ref('');
const busy = ref(false);
const opened = ref(null);
const downloadToken = ref(null);
const downloading = ref(false);
const meta = ref(null);
const burning = ref(false);        // triggers self-destruct animation
const acknowledged = ref(false);
const shareUrl = `${location.origin}/v/${token}`;

async function load() {
  phase.value = 'loading';
  try {
    const data = await api.get(`/api/packages/${token}/metadata`);
    meta.value = data.pkg;
    // Auto-open if no password / no E2E; otherwise prompt.
    if (!meta.value.isPasswordProtected && !meta.value.e2ee) {
      await open();
    } else {
      phase.value = 'password';
    }
  } catch (err) {
    errorMessage.value = err.message;
    phase.value = 'error';
  }
}

async function open() {
  busy.value = true;
  try {
    const data = await api.post(`/api/packages/${token}/open`, {
      password: password.value || undefined,
      recipientEmail: sharedEmail.value || undefined,
    });
    if (data.encrypted) {
      // The server never saw the plaintext; decrypt locally with the passphrase.
      try {
        data.decrypted = await decryptText(password.value, data.payload, data.iv, data.salt);
      } catch {
        errorMessage.value = 'Incorrect passphrase.';
        phase.value = 'error';
        return;
      }
    }
    opened.value = data;
    if (data.burnAfterReading) burning.value = true;
    if (data.downloadToken) downloadToken.value = data.downloadToken;
    phase.value = 'ready';
  } catch (err) {
    errorMessage.value = err.message;
    phase.value = 'error';
  } finally {
    busy.value = false;
  }
}

async function download() {
  if (!downloadToken.value) return;
  downloading.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/packages/${token}/download?token=${downloadToken.value}`);
    if (!res.ok) throw new Error('Download failed.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = opened.value.file?.name || 'download';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    errorMessage.value = err.message;
  } finally {
    downloading.value = false;
  }
}

async function acknowledge() {
  if (acknowledged.value) return;
  busy.value = true;
  try {
    const data = await api.post(`/api/packages/${token}/acknowledge`, {
      recipientEmail: sharedEmail.value || undefined,
    });
    if (data.acknowledged) acknowledged.value = true;
  } catch (err) {
    errorMessage.value = err.message;
  } finally {
    busy.value = false;
  }
}

function openShare(network) {
  const url = encodeURIComponent(shareUrl);
  const text = encodeURIComponent('A secret just for you on DeadDrop 🔒');
  const links = {
    x: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    whatsapp: `https://wa.me/?text=${text}%20${url}`,
  };
  window.open(links[network], '_blank', 'noopener');
}

function hasSecret() {
  return opened.value?.type === 'text' && !opened.value?.encrypted;
}

onMounted(load);
</script>

<template>
  <div class="recipient">
    <div class="brand-mini"><span class="logo-dot">◈</span> DeadDrop</div>

    <div v-if="phase === 'loading'" class="card center">
      <div class="spinner"></div>
      <p class="muted">Opening package…</p>
    </div>

    <div v-else-if="phase === 'error'" class="card center dead">
      <div class="big-icon">🚫</div>
      <h2>This drop is unavailable</h2>
      <p class="muted">{{ errorMessage }}</p>
      <RouterLink to="/">Create your own drop →</RouterLink>
    </div>

    <div v-else-if="phase === 'password'" class="card center gate">
      <div class="big-icon">{{ meta?.e2ee ? '🔐' : '🔒' }}</div>
      <h2>{{ meta?.e2ee ? 'End-to-end encrypted drop' : 'Locked drop' }}</h2>
      <p class="muted">
        <template v-if="meta?.e2ee">Enter your passphrase to decrypt. The server never saw this message.</template>
        <template v-else>This package
          <template v-if="meta && meta.maxViews">allows {{ meta.maxViews }} view{{ meta.maxViews > 1 ? 's' : '' }}</template>
          <template v-if="meta && meta.burnAfterReading"> and <b>burns after reading</b></template>.
        </template>
      </p>
      <div v-if="meta?.shared" class="field" style="margin: 12px auto 0; max-width: 320px; text-align: left">
        <label>Your email (optional, read receipt)</label>
        <input v-model="sharedEmail" type="email" placeholder="you@email.com" />
      </div>
      <form @submit.prevent="open" style="max-width: 320px; margin: 12px auto 0">
        <input v-model="password" type="password" :placeholder="meta?.e2ee ? 'Enter passphrase' : 'Enter password'" autofocus />
        <button class="primary" style="width: 100%; margin-top: 12px" :disabled="busy">
          {{ busy ? 'Unlocking…' : (meta?.e2ee ? 'Decrypt' : 'Unlock') }}
        </button>
      </form>
    </div>

    <div v-else-if="phase === 'ready'" class="card center ready">
      <!-- self-destruct animation overlay -->
      <div v-if="burning" class="burn-overlay" :class="{ gone: !burning }">
        <div class="flame">🔥</div>
        <div class="burn-text">SELF-DES<span class="shred">T</span>RUCTED</div>
      </div>

      <template v-if="opened.type === 'text'">
        <div class="big-icon">{{ opened.encrypted ? '🔐' : '✉️' }}</div>
        <h2>{{ opened.encrypted ? 'Decrypted message' : 'Secret message revealed' }}</h2>
        <pre class="message mono">{{ opened.decrypted || opened.secretText }}</pre>
        <p v-if="opened.burnAfterReading" class="warn">🔥 This message has been burned and can never be viewed again.</p>
      </template>
      <template v-else>
        <div class="big-icon">📎</div>
        <h2>{{ opened.file.name }}</h2>
        <p class="muted">{{ (opened.file.size / 1024).toFixed(1) }} KB · {{ opened.file.mime }}</p>
        <button class="primary" :disabled="downloading" @click="download">
          {{ downloading ? 'Downloading…' : 'Download file' }}
        </button>
        <p v-if="opened.burnAfterReading" class="warn">🔥 This file will be deleted after download.</p>
      </template>

      <div class="spacer"></div>

      <!-- acknowledge -->
      <div v-if="!acknowledged" class="ack-row">
        <button class="primary" :disabled="busy" @click="acknowledge">✅ I've seen it</button>
        <p v-if="busy" class="muted" style="font-size:.8rem">Sending read receipt…</p>
      </div>
      <p v-else class="ack-done">✅ Read receipt sent to the sender</p>

      <!-- share to social -->
      <div class="share-row">
        <span class="muted">Share:</span>
        <button class="ghost share" @click="openShare('x')" title="X">𝕏</button>
        <button class="ghost share" @click="openShare('linkedin')" title="LinkedIn">in</button>
        <button class="ghost share" @click="openShare('whatsapp')" title="WhatsApp">🟢</button>
      </div>
      <p class="muted mono" style="font-size:.72rem; word-break:break-all">{{ shareUrl }}</p>
    </div>
  </div>
</template>

<style scoped>
.recipient { max-width: 560px; margin: 5vh auto 0; display: flex; flex-direction: column; align-items: center; gap: 20px; }
.brand-mini { font-size: 1.05rem; font-weight: 700; }
.logo-dot { color: var(--accent); font-size: 1.3rem; }
.card { width: 100%; }
.big-icon { font-size: 3rem; }
.dead h2, .gate h2, .ready h2 { margin: 12px 0 6px; }
.gate form { max-width: 320px; margin: 12px auto 0; }
.message {
  text-align: left; background: #0c110f; border: 1px solid var(--border);
  border-radius: 12px; padding: 20px; white-space: pre-wrap; word-break: break-word;
  font-size: 1.05rem; line-height: 1.5; margin: 16px auto 8px; max-width: 100%;
}
.warn { color: var(--amber); font-size: 0.85rem; margin-top: 12px; }
.spinner { width: 34px; height: 34px; margin: 0 auto 12px; border: 3px solid var(--border); border-top-color: var(--accent-strong); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* self-destruct / burn animation */
.burn-overlay {
  position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 20px;
  background:
    radial-gradient(circle at center, rgba(255,120,40,0.5), rgba(255,40,0,0.15) 40%, transparent 70%),
    rgba(0,0,0,0.85);
  animation: burnflash 2.4s ease forwards;
  pointer-events: none;
}
.burn-overlay.gone { display: none; }
.flame { font-size: 6rem; animation: flicker 0.5s ease-in-out infinite alternate; }
.burn-text {
  font-weight: 800; font-size: 1.6rem; letter-spacing: 0.35em; color: #ffd9a0;
  text-shadow: 0 0 20px rgba(255,120,40,0.9); font-family: 'SFMono-Regular', ui-monospace, monospace;
}
.shred { color: #ff6b3b; }
@keyframes flicker { from { transform: scale(1) rotate(-4deg); } to { transform: scale(1.12) rotate(4deg); } }
@keyframes burnflash { 0% { opacity: 0; } 20% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; } }

.ack-row { margin-top: 14px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.ack-done { color: var(--accent); font-weight: 600; font-size: 0.9rem; margin-top: 14px; }
.share-row { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 16px; }
.share { padding: 6px 12px; font-weight: 700; }
</style>
