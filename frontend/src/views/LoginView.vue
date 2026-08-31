<script setup>
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const isAdmin = computed(() => route.query.admin === '1');

const email = ref('');
const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    if (isAdmin.value) {
      await auth.adminLogin(username.value, password.value);
      router.push({ name: 'admin-overview' });
    } else {
      await auth.login(email.value, password.value);
      const redirect = route.query.redirect || '/';
      router.push(typeof redirect === 'string' ? redirect : '/');
    }
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
      <div class="head">
        <h1>{{ isAdmin ? 'Admin login' : 'Log in' }}</h1>
      </div>
      <div class="seg" style="margin-bottom: 20px">
        <button :class="{ active: !isAdmin }" @click="$router.replace({ query: {} })">User</button>
        <button :class="{ active: isAdmin }" @click="$router.replace({ query: { admin: '1' } })">Admin</button>
      </div>
      <p class="muted">{{ isAdmin ? 'Sign in to manage the platform.' : 'Sign in to send drops from your account.' }}</p>

      <form @submit.prevent="submit" style="margin-top: 18px">
        <div v-if="isAdmin" class="field">
          <label>Username</label>
          <input v-model="username" autocomplete="off" />
        </div>
        <div v-else class="field">
          <label>Email</label>
          <input v-model="email" type="email" autocomplete="email" />
        </div>
        <div class="field">
          <label>Password</label>
          <input v-model="password" type="password" autocomplete="current-password" />
        </div>
        <div v-if="error" class="alert error">{{ error }}</div>
        <button class="primary grow" style="width: 100%" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Log in' }}
        </button>
      </form>

      <p v-if="!isAdmin" class="muted" style="margin-top: 18px">
        No account? <RouterLink to="/register">Create one</RouterLink> · or
        <RouterLink to="/">send anonymously</RouterLink>
      </p>
      <p class="mono muted" style="font-size: 0.72rem; margin-top: 10px">Demo admin: <b>admin</b> / <b>admin123</b></p>
    </div>
  </div>
</template>

<style scoped>
.auth { max-width: 420px; margin: 6vh auto 0; }
h1 { margin-top: 0; }
</style>
