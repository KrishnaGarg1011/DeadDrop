<script setup>
import { computed } from 'vue';

const props = defineProps({
  page: Number,
  total: Number,
  limit: { type: Number, default: 10 },
});
const emit = defineEmits(['change']);

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.limit)));
const range = computed(() => {
  const n = totalPages.value;
  const p = props.page;
  const out = [];
  const start = Math.max(1, p - 2);
  const end = Math.min(n, start + 4);
  for (let i = start; i <= end; i++) out.push(i);
  return out;
});
</script>

<template>
  <div class="pager">
    <span class="muted">{{ total }} item{{ total === 1 ? '' : 's' }} · page {{ page }} / {{ totalPages }}</span>
    <div class="btns">
      <button :disabled="page <= 1" @click="emit('change', page - 1)">‹</button>
      <button
        v-for="p in range"
        :key="p"
        :class="{ primary: p === page }"
        @click="emit('change', p)"
      >{{ p }}</button>
      <button :disabled="page >= totalPages" @click="emit('change', page + 1)">›</button>
    </div>
  </div>
</template>

<style scoped>
.pager { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 16px; font-size: 0.85rem; flex-wrap: wrap; }
.btns { display: flex; gap: 6px; }
.btns button { padding: 6px 11px; }
</style>
