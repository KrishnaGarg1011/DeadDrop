<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';

const router = useRouter();
const code = ref('');
const submitting = ref(false);
const error = ref('');

// keep it numeric, max 6 digits
function onInput(e) {
  code.value = (e.target.value || '').replace(/\D/g, '').slice(0, 6);
}

async function retrieve() {
  error.value = '';
  if (!/^\d{6}$/.test(code.value)) {
    error.value = 'Enter the 6-digit code you were given.';
    return;
  }
  submitting.value = true;
  try {
    const data = await api.post('/api/packages/retrieve', { code: code.value });
    const token = data.pkg?.token;
    if (!token) throw new Error('No drop found for that access code.');
    router.push({ name: 'receive', params: { token } });
  } catch (err) {
    error.value = err.message || 'No drop found for that access code.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="center retriever">
    <div class="card retrieve-card">
      <div class="big-icon">🔑</div>
      <h1>Retrieve a drop</h1>
      <p class="muted">Enter the 6-digit code the sender shared with you.</p>

      <div class="code-row">
        <input
          class="mono code-input"
          :value="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="000000"
          maxlength="6"
          @input="onInput"
          @keyup.enter="retrieve"
        />
      </div>

      <div v-if="error" class="alert error" style="margin-top: 16px">{{ error }}</div>

      <button class="primary retrieve-btn" :disabled="submitting" @click="retrieve">
        {{ submitting ? 'Looking up…' : 'Retrieve drop' }}
      </button>

      <p class="muted" style="font-size: 0.82rem; margin-top: 18px">
        No code yet? Ask the sender for the link, or use the QR code they generated.
      </p>
    </div>
  </div>
</template>

<style scoped>
.retriever { min-height: 60vh; display: flex; align-items: center; justify-content: center; }
.retrieve-card { width: max-content; min-width: 360px; max-width: 92vw; text-align: center; padding: 40px 38px; }
.big-icon { font-size: 2.6rem; margin-bottom: 8px; }
h1 { margin: 0 0 6px; font-size: 1.6rem; }
.code-row { display: flex; justify-content: center; margin: 22px 0 4px; }
.code-input {
  width: 220px; text-align: center; font-size: 2rem; letter-spacing: 0.35em;
  padding: 14px 10px; border-radius: 14px;
}
.retrieve-btn { width: 100%; margin-top: 18px; padding: 13px; font-size: 1rem; border-radius: 12px; }
</style>
