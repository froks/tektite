<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { revealItemInDir } from '@tauri-apps/plugin-opener'

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
  selectFileNewTab: [entry: FileEntry]
  renameRequest: [payload: { entry: FileEntry; newName: string }]
  newFileRequest: [dir: string]
  newFolderRequest: [dir: string]
}>()

const isExpanded = computed(() => props.expandedDirs.has(props.entry.path))
const children = computed(() => props.childrenMap.get(props.entry.path) ?? null)

// Directory to create new items in: the dir itself for folders, parent for files.
const targetDir = computed(() => {
  if (props.entry.is_dir) return props.entry.path
  const p = props.entry.path
  const last = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return last >= 0 ? p.substring(0, last) : p
})

// ── Inline rename ─────────────────────────────────────────────────────────────
const isRenaming = ref(false)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

async function startRename() {
  // Strip .md for display
  renameValue.value = props.entry.is_dir
    ? props.entry.name
    : props.entry.name.replace(/\.(md|pdf|txt|rst|jpg|jpeg|png|gif|webp|avif|svg)$/, '')
  isRenaming.value = true
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

function commitRename() {
  if (!isRenaming.value) return
  isRenaming.value = false
  const raw = renameValue.value.trim()
  if (!raw || raw === props.entry.name.replace(/\.(md|pdf|txt|rst|jpg|jpeg|png|gif|webp|avif|svg)$/, '')) return
  const extMatch = props.entry.name.match(/\.(md|pdf|txt|rst|jpg|jpeg|png|gif|webp|avif|svg)$/)
  const ext = extMatch ? extMatch[0] : ''
  const newName = props.entry.is_dir
    ? raw
    : (raw.match(/\.(md|pdf|txt|rst|jpg|jpeg|png|gif|webp|avif|svg)$/) ? raw : `${raw}${ext}`)
  emit('renameRequest', { entry: props.entry, newName })
}

function cancelRename() {
  isRenaming.value = false
}

// ── Slow-click (select-then-click) ────────────────────────────────────────────
let clickTimer: ReturnType<typeof setTimeout> | null = null
let lastClickTime = 0

function handleClick(e: MouseEvent) {
  // Middle-click is handled by handleAuxClick; ignore it here
  if (e.button !== 0) return
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

function handleAuxClick(e: MouseEvent) {
  if (e.button === 1 && !props.entry.is_dir) {
    e.preventDefault()
    emit('selectFileNewTab', props.entry)
  }
}

// ── Context menu ──────────────────────────────────────────────────────────────
const contextMenu = ref<{ x: number; y: number } | null>(null)

function showContextMenu(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
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

function contextOpen() {
  dismissContextMenu()
  emit('selectFile', props.entry)
}

function contextOpenNewTab() {
  dismissContextMenu()
  emit('selectFileNewTab', props.entry)
}

async function contextOpenFolder() {
  dismissContextMenu()
  await revealItemInDir(props.entry.path)
}

async function contextCopyPath() {
  dismissContextMenu()
  await navigator.clipboard.writeText(props.entry.path)
}

function contextNewFile() {
  dismissContextMenu()
  emit('newFileRequest', targetDir.value)
}

function contextNewFolder() {
  dismissContextMenu()
  emit('newFolderRequest', targetDir.value)
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
      @auxclick="handleAuxClick"
      @contextmenu="showContextMenu"
    >
      <!-- chevron for dirs -->
      <span v-if="entry.is_dir" class="chevron" :class="{ 'chevron--open': isExpanded }">
        <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor">
          <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/>
        </svg>
      </span>
      <span v-else-if="entry.name.endsWith('.pdf')" class="file-icon file-icon--pdf">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M3.75 0A1.75 1.75 0 0 0 2 1.75v12.5C2 15.216 2.784 16 3.75 16h8.5A1.75 1.75 0 0 0 14 14.25V4.664c0-.464-.184-.909-.513-1.237L10.573.513A1.75 1.75 0 0 0 9.336 0Zm0 1.5h5.586a.25.25 0 0 1 .177.073l2.914 2.914a.25.25 0 0 1 .073.177V14.25a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25V1.75a.25.25 0 0 1 .25-.25ZM5 7.25a.75.75 0 0 1 .75-.75h.5a2 2 0 0 1 0 4h-.5v1a.75.75 0 0 1-1.5 0v-4.25Zm1.5.75v1.5h-.25V8Zm2.25-.75h.5a.75.75 0 0 1 .75.75v2.75a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75V8a.75.75 0 0 1 .75-.75Zm.25 3V8.5h-.5v1.75Zm2.25-3h1.25a.75.75 0 0 1 0 1.5H11.5v.5h.75a.75.75 0 0 1 0 1.5H11.5v.75a.75.75 0 0 1-1.5 0V8a.75.75 0 0 1 .75-.75Z"/>
        </svg>
      </span>
      <span v-else-if="entry.name.endsWith('.txt')" class="file-icon file-icon--txt">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688Z"/>
        </svg>
      </span>
      <span v-else-if="['.jpg','.jpeg','.png','.gif','.webp','.avif','.svg'].some(e => entry.name.endsWith(e))" class="file-icon file-icon--img">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982A6 6 0 0 1 16 8v.5a2.5 2.5 0 0 1-5 0V8a4 4 0 1 0-.943 2.602l.028.032.007.007.004.004a.75.75 0 0 0 1.048-1.074Zm-4.18-2.24a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0Z"/>
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
      <span v-else class="entry-name">{{ entry.name.replace(/\.(md|pdf|txt|rst|jpg|jpeg|png|gif|webp|avif|svg)$/, '') }}</span>
    </div>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="ctx-menu"
        :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
        @mousedown.stop
      >
        <template v-if="!entry.is_dir">
          <button class="ctx-item" @mousedown.prevent="contextOpen">Open</button>
          <button class="ctx-item" @mousedown.prevent="contextOpenNewTab">Open in New Tab</button>
          <div class="ctx-separator" />
        </template>
        <button class="ctx-item" @mousedown.prevent="contextNewFile">New File</button>
        <button class="ctx-item" @mousedown.prevent="contextNewFolder">New Folder</button>
        <div class="ctx-separator" />
        <button class="ctx-item" @mousedown.prevent="contextOpenFolder">Open Containing Folder</button>
        <button class="ctx-item" @mousedown.prevent="contextCopyPath">Copy Path</button>
        <div class="ctx-separator" />
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
        @select-file-new-tab="emit('selectFileNewTab', $event)"
        @rename-request="emit('renameRequest', $event)"
        @new-file-request="emit('newFileRequest', $event)"
        @new-folder-request="emit('newFolderRequest', $event)"
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

.file-icon--pdf {
  color: #f38ba8;
}

.file-icon--txt {
  color: #a6e3a1;
}

.file-icon--img {
  color: #89dceb;
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

.ctx-separator {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
</style>
