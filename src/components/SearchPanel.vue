<script setup lang="ts">
import { ref, nextTick } from 'vue'

defineProps<{
  matchCount: number
  currentIndex: number
}>()

const emit = defineEmits<{
  query: [string]
  next: []
  prev: []
  close: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const query = ref('')

function onInput() {
  emit('query', query.value)
}

function focus(initialValue?: string) {
  if (initialValue !== undefined) {
    query.value = initialValue
    emit('query', initialValue)
  }
  nextTick(() => {
    inputRef.value?.select()
    inputRef.value?.focus()
  })
}

defineExpose({ focus })
</script>

<template>
  <div class="search-panel">
    <input
      ref="inputRef"
      v-model="query"
      placeholder="Find..."
      spellcheck="false"
      autocomplete="off"
      @input="onInput"
      @keydown.enter.exact.prevent="$emit('next')"
      @keydown.shift.enter.exact.prevent="$emit('prev')"
      @keydown.down.exact.prevent="$emit('next')"
      @keydown.up.exact.prevent="$emit('prev')"
      @keydown.escape.prevent="$emit('close')"
    />
    <span class="match-info" :class="{ 'no-results': query && matchCount === 0 }">
      {{ query ? (matchCount === 0 ? 'No results' : `${currentIndex + 1} / ${matchCount}`) : '' }}
    </span>
    <button @click="$emit('prev')" :disabled="matchCount === 0" title="Previous (Shift+Enter)">
      <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
        <path d="M5.5 2 L1.5 8 L9.5 8 Z"/>
      </svg>
    </button>
    <button @click="$emit('next')" :disabled="matchCount === 0" title="Next (Enter)">
      <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
        <path d="M5.5 9 L1.5 3 L9.5 3 Z"/>
      </svg>
    </button>
    <button class="close-btn" @click="$emit('close')" title="Close (Esc)">✕</button>
  </div>
</template>

<style scoped>
.search-panel {
  position: absolute;
  top: 8px;
  right: 20px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--editor-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 6px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  width: 190px;
  padding: 0 4px;
}

input::placeholder {
  color: var(--text-muted);
}

.match-info {
  font-size: 11px;
  color: var(--text-muted);
  min-width: 64px;
  text-align: center;
  white-space: nowrap;
  padding: 0 2px;
}

.match-info.no-results {
  color: #f38ba8;
}

button {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 3px 5px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: color 0.1s, background 0.1s;
}

button:hover:not(:disabled) {
  color: var(--text);
  background: var(--hover-bg);
}

button:disabled {
  opacity: 0.35;
  cursor: default;
}

.close-btn {
  font-size: 13px;
  margin-left: 2px;
}
</style>
