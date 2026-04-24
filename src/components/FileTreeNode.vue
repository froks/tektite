<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'

interface FileEntry {
  name: string
  path: string
  is_dir: boolean
}

const props = defineProps<{
  entry: FileEntry
  activeFile: string | null
  expandedDirs: Set<string>
  childrenMap: Map<string, FileEntry[]>
  depth: number
}>()

const emit = defineEmits<{
  toggleDir: [entry: FileEntry]
  selectFile: [entry: FileEntry]
  renameRequest: [payload: { entry: FileEntry; newName: string }]
}>()

const isExpanded = computed(() => props.expandedDirs.has(props.entry.path))
const children = computed(() => props.childrenMap.get(props.entry.path) ?? null)

// ── Inline rename ─────────────────────────────────────────────────────────────
const isRenaming = ref(false)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

async function startRename() {
  // Strip .md for display
  renameValue.value = props.entry.is_dir
    ? props.entry.name
    : props.entry.name.replace(/\.md$/, '')
  isRenaming.value = true
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

function commitRename() {
  if (!isRenaming.value) return
  isRenaming.value = false
  const raw = renameValue.value.trim()
  if (!raw || raw === props.entry.name.replace(/\.md$/, '')) return
  const newName = props.entry.is_dir ? raw : raw.endsWith('.md') ? raw : `${raw}.md`
  emit('renameRequest', { entry: props.entry, newName })
}

function cancelRename() {
  isRenaming.value = false
}

// ── Slow-click (select-then-click) ────────────────────────────────────────────
let clickTimer: ReturnType<typeof setTimeout> | null = null
let lastClickTime = 0

function handleClick(_e: MouseEvent) {
  if (props.entry.is_dir) {
    emit('toggleDir', props.entry)
    return
  }
  const now = Date.now()
  const isAlreadyActive = props.entry.path === props.activeFile
  const gap = now - lastClickTime
  lastClickTime = now

  if (isAlreadyActive && gap > 500 && gap < 2000) {
    // Slow second click on already-selected file → rename
    if (clickTimer) clearTimeout(clickTimer)
    startRename()
  } else {
    // First click or fast double-click → just select
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = setTimeout(() => {
      emit('selectFile', props.entry)
    }, 0)
  }
}

// ── Context menu ──────────────────────────────────────────────────────────────
const contextMenu = ref<{ x: number; y: number } | null>(null)

function showContextMenu(e: MouseEvent) {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY }
  window.addEventListener('mousedown', dismissContextMenu, { once: true })
}

function dismissContextMenu() {
  contextMenu.value = null
}

function contextRename() {
  dismissContextMenu()
  startRename()
}

defineExpose({ startRename })
</script>

<template>
  <div class="tree-node">
    <div
      class="tree-row"
      :class="{
        'tree-row--active': !entry.is_dir && entry.path === activeFile,
        'tree-row--dir': entry.is_dir,
      }"
      :style="{ paddingLeft: `${8 + depth * 14}px` }"
      @click="handleClick"
      @contextmenu="showContextMenu"
    >
      <!-- chevron for dirs -->
      <span v-if="entry.is_dir" class="chevron" :class="{ 'chevron--open': isExpanded }">
        <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor">
          <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/>
        </svg>
      </span>
      <span v-else class="file-icon">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688Z"/>
        </svg>
      </span>

      <!-- Inline rename input or label -->
      <input
        v-if="isRenaming"
        ref="renameInput"
        class="rename-input"
        v-model="renameValue"
        @keydown.enter.prevent="commitRename"
        @keydown.escape.prevent="cancelRename"
        @blur="commitRename"
        @click.stop
        @mousedown.stop
      />
      <span v-else class="entry-name">{{ entry.name.replace(/\.md$/, '') }}</span>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="ctx-menu"
        :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
        @mousedown.stop
      >
        <button class="ctx-item" @mousedown.prevent="contextRename">Rename</button>
      </div>
    </Teleport>

    <!-- Recursive children -->
    <div v-if="entry.is_dir && isExpanded && children">
      <FileTreeNode
        v-for="child in children"
        :key="child.path"
        :entry="child"
        :active-file="activeFile"
        :expanded-dirs="expandedDirs"
        :children-map="childrenMap"
        :depth="depth + 1"
        @toggle-dir="emit('toggleDir', $event)"
        @select-file="emit('selectFile', $event)"
        @rename-request="emit('renameRequest', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-top: 3px;
  padding-bottom: 3px;
  padding-right: 8px;
  cursor: pointer;
  border-radius: 4px;
  margin: 0 4px;
  color: var(--text);
  font-size: 13px;
}

.tree-row:hover {
  background: var(--hover-bg);
}

.tree-row--active {
  background: var(--active-bg) !important;
  color: var(--accent);
}

.tree-row--dir {
  font-weight: 500;
}

.chevron {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  transition: transform 0.15s;
  flex-shrink: 0;
}

.chevron--open {
  transform: rotate(90deg);
}

.file-icon {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  flex-shrink: 0;
  margin-left: 2px;
}

.entry-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rename-input {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-family: inherit;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 0 4px;
  height: 20px;
  outline: none;
}

.ctx-menu {
  position: fixed;
  z-index: 9999;
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  min-width: 120px;
}

.ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
  padding: 5px 10px;
  border-radius: 4px;
}

.ctx-item:hover {
  background: var(--hover-bg);
}
</style>
