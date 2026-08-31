<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();

const email = ref('');
const password = ref('');
const confirm = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  if (password.value.length < 6) {
    error.value = 'Password must be at least 6 characters.';
    return;
  }
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match.';
    return;
  }
  busy.value = true;
  try {
    await auth.register(email.value, password.value);
    router.push('/');
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth">
    <div class="card">
      <h1>Create account</h1>
      <p class="muted">Register to attribute your drops to an account.</p>
      <form @submit.prevent="submit">
        <div class="field">
          <label>Email</label>
          <input v-model="email" type="email" autocomplete="email" />
        </div>
        <div class="field">
          <label>Password</label>
          <input v-model="password" type="password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label>Confirm password</label>
          <input v-model="confirm" type="password" autocomplete="new-password" />
        </div>
        <div v-if="error" class="alert error">{{ error }}</div>
        <button class="primary grow" style="width: 100%" :disabled="busy">
          {{ busy ? 'Creating…' : 'Create account' }}
        </button>
      </form>
      <p class="muted" style="margin-top: 18px">
        Already have an account? <RouterLink to="/login">Log in</RouterLink> · or
        <RouterLink to="/">send anonymously</RouterLink>
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth { max-width: 420px; margin: 6vh auto 0; }
h1 { margin-top: 0; }
</style>
