import { ref } from 'vue';

const KEY = 'deaddrop_theme';
const stored = (() => {
  try { return localStorage.getItem(KEY); } catch { return null; }
})();
const initial = stored === 'light' ? 'light' : 'dark';
export const theme = ref(initial);

function apply() {
  document.documentElement.setAttribute('data-theme', theme.value);
}
apply();

export function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light';
  try { localStorage.setItem(KEY, theme.value); } catch {}
  apply();
}
