<script setup lang="ts">
export interface Tab {
  id: string
  path: string
  title: string
  isDirty: boolean
}

defineProps<{
  tabs: Tab[]
  activeTabId: string | null
}>()

const emit = defineEmits<{
  activate: [id: string]
  close: [id: string]
}>()

function handleMiddleClick(e: MouseEvent, id: string) {
  if (e.button === 1) {
    e.preventDefault()
    emit('close', id)
  }
}
</script>

<template>
  <div class="tab-bar" v-if="tabs.length > 0">
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="tab"
      :class="{ 'tab--active': tab.id === activeTabId }"
      @click="emit('activate', tab.id)"
      @mousedown="handleMiddleClick($event, tab.id)"
      :title="tab.path"
    >
      <span class="tab-title">{{ tab.title }}</span>
      <span v-if="tab.isDirty" class="tab-dirty" title="Unsaved changes">●</span>
      <button
        class="tab-close"
        @click.stop="emit('close', tab.id)"
        @mousedown.stop
        title="Close tab"
      >
        <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  align-items: stretch;
  background: var(--editor-bg);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: none;
}

.tab-bar::-webkit-scrollbar {
  display: none;
}

.tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px 0 12px;
  min-width: 80px;
  max-width: 200px;
  height: 34px;
  cursor: pointer;
  border-right: 1px solid var(--border);
  background: var(--sidebar-bg);
  color: var(--text-muted);
  font-size: 12px;
  flex-shrink: 0;
  position: relative;
  transition: background 0.1s, color 0.1s;
  user-select: none;
}

.tab:hover {
  background: var(--hover-bg);
  color: var(--text);
}

.tab--active {
  background: var(--editor-bg);
  color: var(--text);
  border-top: 2px solid var(--accent);
  padding-top: 2px;
}

.tab--active:hover {
  background: var(--editor-bg);
}

.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.tab-dirty {
  color: #fab387;
  font-size: 10px;
  flex-shrink: 0;
  line-height: 1;
}

.tab-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 2px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0;
  transition: background 0.1s, color 0.1s, opacity 0.1s;
  margin-left: 2px;
}

.tab:hover .tab-close,
.tab--active .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--hover-bg);
  color: var(--text);
}
</style>
