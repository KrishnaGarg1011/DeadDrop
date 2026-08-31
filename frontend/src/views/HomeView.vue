<script setup>
import { ref, computed, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import QRCode from 'qrcode';
import { api } from '../api/client.js';
import { encryptText } from '../utils/crypto.js';
import { getGuestId } from '../utils/guest.js';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();

// content
const type = ref('text');           // 'text' | 'file'
const secretText = ref('');
const file = ref(null);

// expiry presets (hours) — null means Never
const expirePresets = [
  { label: '1 hour', hours: 1 },
  { label: '6 hours', hours: 6 },
  { label: '12 hours', hours: 12 },
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
  { label: 'Never', hours: null },
];
const expire = ref(null);           // selected preset hours, or null (Never)

// view limit presets (max_views) — 'unlimited'
const viewPresets = [
  { label: 'Unlimited', views: null },
  { label: '1 view', views: 1 },
  { label: '2 views', views: 2 },
  { label: '5 views', views: 5 },
  { label: '10 views', views: 10 },
];
const viewLimit = ref('unlimited'); // 'unlimited' | number

// security
const usePassword = ref(false);
const password = ref('');
const burnAfterReading = ref(false);
const e2ee = ref(false);            // end-to-end encrypt (text drops)
const encryptFile = ref(true);      // AES-encrypt uploaded files at rest
const recipients = ref('');         // comma/JSON separated emails (shared drop)

const submitting = ref(false);
const createdPkg = ref(null);
const qrDataUrl = ref('');
const error = ref('');
let toastTimer = null;
const toast = ref(null);

const shareUrl = computed(() =>
  createdPkg.value ? `${location.origin}/v/${createdPkg.value.token}` : ''
);

function notify(msg, kind = 'success') {
  toast.value = { msg, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 2600);
}

function onFile(e) {
  file.value = e.target.files[0] || null;
}

async function submit() {
  error.value = '';
  if (type.value === 'text' && !e2ee.value && !secretText.value.trim()) {
    error.value = 'Enter a secret message first.';
    return;
  }
  if (type.value === 'file' && !file.value) {
    error.value = 'Choose a file to share.';
    return;
  }
  if (e2ee.value && password.value.length < 4) {
    error.value = 'End-to-end encryption requires a password (at least 4 characters).';
    return;
  }
  if (usePassword.value && !e2ee.value && password.value.length < 4) {
    error.value = 'Password must be at least 4 characters.';
    return;
  }

  const fd = new FormData();
  fd.append('type', type.value);
  fd.append('burn_after_reading', burnAfterReading.value ? 'true' : 'false');
  // Guests are not tied to an account, so stamp the drop with this browser's
  // session id so the sender can view it under "My drops" for this session.
  if (!auth.isAuthenticated && getGuestId()) fd.append('guest_id', getGuestId());

  if (type.value === 'text') {
    if (e2ee.value) {
      // Encrypt client-side; the server only ever sees ciphertext.
      const { payload, iv, salt } = await encryptText(password.value, secretText.value);
      fd.append('e2ee', 'true');
      fd.append('enc_payload', payload);
      fd.append('enc_iv', iv);
      fd.append('enc_salt', salt);
      fd.append('is_password_protected', 'false');
    } else {
      fd.append('secret_text', secretText.value);
      if (usePassword.value) {
        fd.append('is_password_protected', 'true');
        fd.append('password', password.value);
      }
    }
  } else {
    fd.append('file', file.value);
    fd.append('file_crypto', encryptFile.value ? 'true' : 'false');
    if (usePassword.value) {
      fd.append('is_password_protected', 'true');
      fd.append('password', password.value);
    }
  }

  if (expire.value !== null && expire.value !== 'Never') fd.append('expires_in_hours', String(expire.value));
  if (viewLimit.value !== 'unlimited') fd.append('max_views', String(viewLimit.value));

  // shared/team drop recipient emails
  const emailList = recipients.value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (emailList.length) fd.append('recipient_emails', JSON.stringify(emailList));

  submitting.value = true;
  try {
    const data = await api.postForm('/api/packages', fd);
    createdPkg.value = data.pkg;
    qrDataUrl.value = await QRCode.toDataURL(shareUrl.value, { margin: 1, width: 220, color: { dark: '#0a0d0c', light: '#ffffff' } });
  } catch (err) {
    error.value = err.message;
  } finally {
    submitting.value = false;
  }
}

function reset() {
  createdPkg.value = null;
  qrDataUrl.value = '';
  secretText.value = '';
  file.value = null;
  password.value = '';
  type.value = 'text';
  expire.value = null;
  viewLimit.value = 'unlimited';
  usePassword.value = false;
  burnAfterReading.value = false;
  e2ee.value = false;
  encryptFile.value = true;
  recipients.value = '';
}

// Enabling E2E implies a password is used by the recipient.
watch(e2ee, (v) => { if (v) usePassword.value = true; });

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    notify('Link copied to clipboard.');
  } catch {
    // fallback for older browsers / non-secure contexts
    const el = document.createElement('textarea');
    el.value = shareUrl.value;
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); notify('Link copied to clipboard.'); }
    catch { notify('Copy failed — select the link manually.', 'error'); }
    document.body.removeChild(el);
  }
}

const features = [
  { icon: '🔥', title: 'Burn after reading', desc: 'Packages self-destruct immediately after the first view.' },
  { icon: '🔒', title: 'Locked & E2E', desc: 'Passwords, lockout, and client-side end-to-end encryption.' },
  { icon: '⏱', title: 'Expiry & view limits', desc: 'Time-based access with strict view-count enforcement.' },
  { icon: '📋', title: 'Live tracking & audit', desc: 'Real-time open notifications plus a full audit trail.' },
];

function openShare(network) {
  const url = encodeURIComponent(shareUrl.value);
  const text = encodeURIComponent('A secret just for you on DeadDrop 🔒');
  const links = {
    x: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    whatsapp: `https://wa.me/?text=${text}%20${url}`,
  };
  window.open(links[network], '_blank', 'noopener');
}

onUnmounted(() => clearTimeout(toastTimer));
</script>

<template>
  <div class="home">
    <!-- LEFT: hero -->
    <section class="hero">
      <span class="badge-pill">● Ephemeral · Secure · Audited</span>
      <h1>Share secrets that<br />delete themselves<span class="dot">.</span></h1>
      <p class="lede">
        DeadDrop lets you send a secret message or file that expires, burns after
        reading, and records every access attempt — so the recipient sees it
        exactly once, and only you can revoke it.
      </p>
      <RouterLink to="/retrieve" class="retrieve-pill">🔑 Have a 6-digit code? Retrieve a drop →</RouterLink>

      <div class="features">
        <div v-for="f in features" :key="f.title" class="feature">
          <div class="fico">{{ f.icon }}</div>
          <div>
            <div class="ftitle">{{ f.title }}</div>
            <p class="fdesc muted">{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- RIGHT: compose -->
    <section class="panel">
      <div v-if="createdPkg" class="card created">
        <h2>Drop created 🎉</h2>
        <p class="muted">Scan the QR or send this link to your recipient.</p>
        <div class="code-box">
          <span class="cb-label muted">Or give them the code</span>
          <div class="cb-digits mono">{{ createdPkg.accessCode || '·······' }}</div>
        </div>
        <div class="qr-row">
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR code" class="qr" />
          <div class="link-box">
            <input class="mono" readonly :value="shareUrl" />
            <button class="primary" @click="copyLink">Copy</button>
          </div>
        </div>
        <div class="rules">
          <span class="badge" v-if="createdPkg.burnAfterReading">burn after reading</span>
          <span class="badge" v-if="createdPkg.e2ee">🔐 end-to-end encrypted</span>
          <span class="badge" v-if="createdPkg.isPasswordProtected">password protected</span>
          <span class="badge" v-if="createdPkg.maxViews">max {{ createdPkg.maxViews }} views</span>
          <span class="badge" v-if="createdPkg.expiresAt">expires {{ new Date(createdPkg.expiresAt).toLocaleDateString() }}</span>
        </div>
        <div class="share-line">
          <span class="muted">Share to:</span>
          <button class="ghost share" @click="openShare('x')" title="Share on X">𝕏</button>
          <button class="ghost share" @click="openShare('linkedin')" title="Share on LinkedIn">in</button>
          <button class="ghost share" @click="openShare('whatsapp')" title="Share on WhatsApp">✆</button>
        </div>
        <div class="row actions">
          <button class="ghost" @click="router.push({ name: 'receive', params: { token: createdPkg.token } })">Preview as recipient</button>
          <button class="ghost" @click="router.push({ name: 'dashboard' })">My drops</button>
          <button class="primary" @click="reset">Create another</button>
        </div>
        <p v-if="!auth.isAuthenticated" class="muted" style="font-size: 0.82rem; margin: 12px 0 0">
          👤 Tracking this drop under your <b>guest session</b> — see it in My drops. Log in to keep it permanently.
        </p>
      </div>

      <div v-else class="card compose">
        <div class="compose-head">
          <h2>Compose a drop</h2>
          <div class="seg">
            <button :class="{ active: type === 'text' }" @click="type = 'text'">Secret message</button>
            <button :class="{ active: type === 'file' }" @click="type = 'file'">File upload</button>
          </div>
        </div>

        <!-- content -->
        <div class="field" style="margin-top: 20px">
          <label>{{ type === 'text' ? 'Secret message' : 'File to share' }}</label>
          <textarea
            v-if="type === 'text'"
            v-model="secretText"
            rows="6"
            placeholder="Type your secret message…"
          ></textarea>
          <label v-else class="dropzone" :class="{ hasfile: file }">
            <input type="file" @change="onFile" hidden />
            <template v-if="file">
              <span class="dz-icon">📄</span>
              <span>{{ file.name }}</span>
              <span class="muted">({{ (file.size / 1024).toFixed(1) }} KB)</span>
            </template>
            <template v-else>
              <span class="dz-icon">⇧</span>
              <span class="muted">Drag & drop or <span class="accent">browse</span></span>
            </template>
          </label>
        </div>

        <!-- expiry -->
        <div class="field">
          <label>Expires after</label>
          <div class="pillrow">
            <button
              v-for="p in expirePresets"
              :key="p.label"
              class="pillbtn"
              :class="{ active: (expire === null) ? p.hours === null : p.hours === expire }"
              @click="expire = p.hours"
            >{{ p.label }}</button>
          </div>
        </div>

        <!-- view limit -->
        <div class="field">
          <label>View limit</label>
          <div class="pillrow">
            <button
              v-for="p in viewPresets"
              :key="p.label"
              class="pillbtn"
              :class="{ active: viewLimit === (p.views === null ? 'unlimited' : p.views) }"
              @click="viewLimit = p.views === null ? 'unlimited' : p.views"
            >{{ p.label }}</button>
          </div>
        </div>

        <!-- password -->
        <div class="field">
          <div class="pw-toggle">
            <span class="lock">{{ e2ee ? '🔐' : '🔒' }}</span>
            <label style="margin:0; text-transform:none; letter-spacing:0">
              <b style="color: var(--text)">{{ e2ee ? 'Encryption passphrase' : 'Require a password' }}</b>
              <span v-if="!e2ee" class="muted" style="display:block; font-weight:400; font-size:0.82rem">Optional — leave off for a plain drop.</span>
              <span v-else class="muted" style="display:block; font-weight:400; font-size:0.82rem">Required — only the holder can decrypt.</span>
            </label>
            <input
              v-if="e2ee"
              type="checkbox"
              checked
              disabled
              style="width:auto; margin-left:auto"
            />
            <input
              v-else
              type="checkbox"
              v-model="usePassword"
              style="width:auto; margin-left:auto"
            />
          </div>
          <div v-if="usePassword || e2ee" class="pw" style="margin-top: 10px">
            <span class="lock">{{ e2ee ? '🔐' : '🔒' }}</span>
            <input
              type="password"
              v-model="password"
              :placeholder="e2ee ? 'Set a passphrase (min 4 chars)' : 'Set a password (min 4 chars)'"
            />
          </div>
        </div>

        <!-- burn -->
        <div class="checkbox-line">
          <input type="checkbox" id="burn" v-model="burnAfterReading" />
          <label for="burn" style="margin: 4px 0 0; text-transform: none; letter-spacing: 0">
            <b style="color: var(--text)">Burn after reading</b>
            <span class="muted" style="display:block; font-weight: 400; font-size: 0.82rem">
              Destroy the drop immediately after the first successful view.
            </span>
          </label>
        </div>

        <!-- E2E (text) -->
        <div v-if="type === 'text'" class="checkbox-line" style="margin-top: 12px">
          <input type="checkbox" id="e2ee" v-model="e2ee" />
          <label for="e2ee" style="margin: 4px 0 0; text-transform: none; letter-spacing: 0">
            <b style="color: var(--text)">🔐 End-to-end encrypt</b>
            <span class="muted" style="display:block; font-weight: 400; font-size: 0.82rem">
              Encrypted in your browser — only your recipient's passphrase can read it. The server stores ciphertext only.
            </span>
          </label>
        </div>

        <!-- file at-rest encryption -->
        <div v-else class="checkbox-line" style="margin-top: 12px">
          <input type="checkbox" id="fcrypto" v-model="encryptFile" />
          <label for="fcrypto" style="margin: 4px 0 0; text-transform: none; letter-spacing: 0">
            <b style="color: var(--text)">🔐 Encrypt file at rest (AES-256)</b>
            <span class="muted" style="display:block; font-weight: 400; font-size: 0.82rem">
              The stored file is encrypted on the server's disk and decrypted on download.
            </span>
          </label>
        </div>

        <!-- shared / team drop -->
        <div class="field" style="margin-top: 12px">
          <label>Share with (optional — team drop)</label>
          <div class="pw" style="gap: 8px">
            <span class="lock">👥</span>
            <input
              v-model="recipients"
              placeholder="Separate with commas, e.g. a@x.com, b@y.com"
            />
          </div>
          <p v-if="recipients.trim()" class="muted" style="font-size: 0.8rem; margin: 6px 0 0">
            {{ recipients.split(/[,\s]+/).filter(Boolean).length }} recipient(s) will be tracked for read status.
          </p>
        </div>

        <div v-if="error" class="alert error" style="margin-top: 18px">{{ error }}</div>

        <button class="primary make" :disabled="submitting" @click="submit">
          {{ submitting ? 'Creating…' : 'Create DeadDrop' }}
        </button>
      </div>
    </section>

    <transition name="fade">
      <div v-if="toast" class="toast" :class="toast.kind">{{ toast.msg }}</div>
    </transition>
  </div>
</template>

<style scoped>
.home { display: grid; grid-template-columns: minmax(0,1fr) 460px; gap: 56px; align-items: start; padding-top: 30px; }
.hero { position: sticky; top: 20px; }

.badge-pill {
  display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid var(--border-2); background: var(--bg-2);
  color: var(--muted); font-size: 0.78rem; font-weight: 600;
  padding: 6px 14px; border-radius: 999px;
}
.badge-pill::first-letter { /* dot is in markup */ }
.badge-pill { position: relative; }
.badge-pill::before { content: '●'; color: var(--accent); }

h1 { font-size: 2.7rem; line-height: 1.12; font-weight: 800; letter-spacing: -0.02em; margin: 20px 0 14px; }
.dot { color: var(--accent); }
.lede { color: var(--muted); font-size: 1.02rem; line-height: 1.6; max-width: 440px; margin: 0 0 20px; }
.retrieve-pill { display: inline-flex; align-items: center; gap: 8px; font-size: 0.9rem; font-weight: 600; color: var(--accent); border: 1px solid var(--border-2); background: var(--bg-2); border-radius: 999px; padding: 9px 18px; margin-bottom: 26px; }
.retrieve-pill:hover { border-color: var(--accent-strong); text-decoration: none; }

.features { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; max-width: 500px; }
.feature {
  background: var(--bg-2); border: 1px solid var(--border); border-radius: 14px; padding: 18px;
  display: flex; gap: 12px; align-items: flex-start;
}
.fico { font-size: 1.4rem; line-height: 1; }
.ftitle { font-weight: 700; margin-bottom: 4px; }
.fdesc { font-size: 0.82rem; line-height: 1.5; margin: 0; }

.compose { padding: 26px 26px 30px; }
.compose-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.compose-head h2 { margin: 0; font-size: 1.3rem; }

textarea { resize: vertical; }
.dropzone {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; min-height: 130px; border: 1px dashed var(--border-2); border-radius: 12px;
  background: #0c110f; padding: 20px; text-align: center; cursor: pointer;
}
.dropzone.hasfile { border-style: solid; border-color: var(--accent-strong); color: var(--text); }
.dz-icon { font-size: 1.6rem; color: var(--muted); }
.accent { color: var(--accent); }

.pillrow { display: flex; flex-wrap: wrap; gap: 8px; }

.pw { display: flex; align-items: center; gap: 8px; position: relative; }
.pw .lock { position: absolute; left: 12px; font-size: 0.9rem; opacity: 0.7; }
.pw input { padding-left: 36px; }
.pw .x { position: absolute; right: 8px; padding: 4px 8px; }
.pw-toggle { display: flex; align-items: center; gap: 10px; }
.pw-toggle .lock { font-size: 1rem; }

.make { width: 100%; margin-top: 20px; padding: 13px; font-size: 1rem; border-radius: 12px; }

.created h2 { margin-top: 0; }
.code-box { text-align: center; margin: 16px 0 2px; padding: 12px; border: 1px dashed var(--border-2); border-radius: 12px; background: var(--bg-2); }
.cb-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; }
.cb-digits { font-size: 1.9rem; font-weight: 800; letter-spacing: 0.5em; color: var(--accent-strong); margin-top: 4px; }
.qr-row { display: flex; gap: 16px; align-items: center; margin: 12px 0; }
.qr { width: 150px; height: 150px; border-radius: 10px; background: #fff; padding: 6px; flex: none; }
.link-box { display: flex; gap: 10px; flex: 1; }
.link-box input { flex: 1; }
@media (max-width: 480px) { .qr-row { flex-direction: column; align-items: stretch; } .qr { width: 100%; height: auto; } }
.rules { display: flex; gap: 8px; flex-wrap: wrap; }
.share-line { display: flex; align-items: center; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border); }
.share { padding: 6px 12px; font-weight: 700; }
.actions { margin-top: 14px; }

@media (max-width: 900px) {
  .home { grid-template-columns: 1fr; gap: 24px; padding-top: 8px; }
  .hero { position: static; text-align: center; }
  .lede { max-width: 520px; margin: 0 auto 16px; }
  h1 { font-size: 2.1rem; }
  .features { grid-template-columns: 1fr; max-width: 520px; margin: 0 auto; }
}
@media (max-width: 560px) {
  .home { gap: 18px; }
  h1 { font-size: 1.8rem; }
  .lede { font-size: 0.98rem; }
  .compose { padding: 20px 16px 24px; }
  .compose-head { flex-direction: column; align-items: stretch; }
  .compose-head .seg { width: 100%; }
  .seg { width: 100%; }
  .seg button { flex: 1; }
  .retrieve-pill { width: 100%; justify-content: center; }
  .row.actions { flex-direction: column; }
  .row.actions > * { width: 100%; }
  .qr-row { flex-direction: column; align-items: stretch; }
  .qr { width: 100%; height: auto; }
  .link-box { flex-direction: column; }
  .cb-digits { font-size: 1.6rem; letter-spacing: 0.35em; }
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
