<script setup lang="ts">
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import FileSidebar from './components/FileSidebar.vue'
import MarkdownEditor from './components/MarkdownEditor.vue'
import TabBar, { type Tab } from './components/TabBar.vue'
import PdfViewer from './components/PdfViewer.vue'
import ImageViewer from './components/ImageViewer.vue'

const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const pdfRef = ref<InstanceType<typeof PdfViewer> | null>(null)

// ── File type helper ──────────────────────────────────────────────────────────
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg']
const CODE_EXTS = ['.ps1', '.sh', '.bat', '.cmd']

function fileType(path: string | null): 'markdown' | 'pdf' | 'text' | 'image' | 'rst' | 'code' | null {
  if (!path) return null
  if (path.endsWith('.pdf')) return 'pdf'
  if (path.endsWith('.txt')) return 'text'
  if (path.endsWith('.rst')) return 'rst'
  if (CODE_EXTS.some(ext => path.endsWith(ext))) return 'code'
  if (IMAGE_EXTS.some(ext => path.endsWith(ext))) return 'image'
  return 'markdown'
}

const activeFileType = computed(() => fileType(activeFile.value))

// ── Tab state ─────────────────────────────────────────────────────────────────
const tabs = ref<Tab[]>([])
const activeTabId = ref<string | null>(null)
let tabIdCounter = 0

function makeTabId() {
  return `tab-${++tabIdCounter}`
}

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? null)
const activeFile = computed(() => activeTab.value?.path ?? null)
const fileContent = ref('')

// Per-tab content cache so switching tabs restores in-memory content
const tabContents = new Map<string, string>()

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

async function openFileInTab(path: string, newTab: boolean) {
  // If already open in a tab, just activate it
  const existing = tabs.value.find(t => t.path === path)
  if (existing) {
    activeTabId.value = existing.id
    fileContent.value = tabContents.get(existing.id) ?? ''
    return
  }

  // Save the current tab before leaving if dirty
  if (activeTab.value?.isDirty && !newTab) {
    await saveTab(activeTab.value)
  }

  let content = ''
  if (fileType(path) !== 'pdf' && fileType(path) !== 'image') {
    try {
      content = await invoke<string>('read_file', { path })
    } catch (e) {
      console.error('Failed to read file:', e)
    }
  }

  if (!newTab && activeTabId.value) {
    // Replace current tab
    const idx = tabs.value.findIndex(t => t.id === activeTabId.value)
    if (idx !== -1) {
      const oldId = tabs.value[idx].id
      tabContents.delete(oldId)
      const id = makeTabId()
      const tab: Tab = { id, path, title: fileName(path), isDirty: false }
      tabs.value.splice(idx, 1, tab)
      activeTabId.value = id
      tabContents.set(id, content)
      fileContent.value = content
      return
    }
  }

  // Open as new tab
  const id = makeTabId()
  const tab: Tab = { id, path, title: fileName(path), isDirty: false }
  tabs.value.push(tab)
  activeTabId.value = id
  tabContents.set(id, content)
  fileContent.value = content
}

async function activateTab(id: string) {
  if (id === activeTabId.value) return
  // Save current tab if dirty
  if (activeTab.value?.isDirty) {
    await saveTab(activeTab.value)
  }
  // Store the current editor content back
  if (activeTabId.value) {
    tabContents.set(activeTabId.value, fileContent.value)
  }
  activeTabId.value = id
  const tab = tabs.value.find(t => t.id === id)
  if (tab) {
    if (fileType(tab.path) === 'pdf' || fileType(tab.path) === 'image') {
      fileContent.value = ''
    } else {
      const cached = tabContents.get(id)
      if (cached !== undefined) {
        fileContent.value = cached
      } else {
        try {
          fileContent.value = await invoke<string>('read_file', { path: tab.path })
          tabContents.set(id, fileContent.value)
        } catch (e) {
          console.error('Failed to read file:', e)
          fileContent.value = ''
        }
      }
    }
  }
}

async function closeTab(id: string) {
  const tab = tabs.value.find(t => t.id === id)
  if (!tab) return
  if (tab.isDirty) {
    await saveTab(tab)
  }
  tabContents.delete(id)
  const idx = tabs.value.findIndex(t => t.id === id)
  tabs.value.splice(idx, 1)

  if (activeTabId.value === id) {
    // Activate adjacent tab
    const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? null
    if (next) {
      activeTabId.value = next.id
      fileContent.value = tabContents.get(next.id) ?? ''
    } else {
      activeTabId.value = null
      fileContent.value = ''
    }
  }
}

// ── Save helpers ──────────────────────────────────────────────────────────────
let saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function saveTab(tab: Tab) {
  if (!tab.isDirty) return
  const content = tabContents.get(tab.id)
  if (content === undefined) return
  try {
    await invoke('write_file', { path: tab.path, content })
    tab.isDirty = false
  } catch (e) {
    console.error('Failed to save file:', e)
  }
}

async function saveCurrentFile() {
  if (!activeTab.value) return
  // Flush current editor content
  const content = fileContent.value
  tabContents.set(activeTab.value.id, content)
  activeTab.value.isDirty = true // ensure save runs
  await saveTab(activeTab.value)
}

// ── Editor change handler ─────────────────────────────────────────────────────
function handleEditorChange(content: string) {
  fileContent.value = content
  const tab = activeTab.value
  if (!tab) return
  tab.isDirty = true
  tabContents.set(tab.id, content)

  if (saveTimers.has(tab.id)) clearTimeout(saveTimers.get(tab.id)!)
  saveTimers.set(tab.id, setTimeout(async () => {
    saveTimers.delete(tab.id)
    await saveTab(tab)
  }, 800))
}

// ── Sidebar events ────────────────────────────────────────────────────────────
const rootPath = ref('')

function handleFolderOpened(path: string) {
  rootPath.value = path
}

function handleFolderClosed() {
  rootPath.value = ''
  tabs.value = []
  tabContents.clear()
  activeTabId.value = null
  fileContent.value = ''
}

function handleFileRenamed(oldPath: string, newPath: string) {
  for (const tab of tabs.value) {
    if (tab.path === oldPath) {
      tab.path = newPath
      tab.title = fileName(newPath)
    }
  }
}

async function handleFileSelected(path: string, newTab = false) {
  await openFileInTab(path, newTab)
}

async function handleExternalChange(path: string) {
  const tab = tabs.value.find(t => t.path === path)
  if (!tab || tab.isDirty || fileType(path) === 'pdf' || fileType(path) === 'image') return
  try {
    const content = await invoke<string>('read_file', { path })
    tabContents.set(tab.id, content)
    if (activeTabId.value === tab.id) {
      fileContent.value = content
    }
  } catch (e) {
    console.error('Failed to reload externally changed file:', e)
  }
}

// ── Navigate (link clicks in editor) ─────────────────────────────────────────
async function handleNavigate(path: string) {
  await openFileInTab(path, false)
}

// ── Sidebar resize/collapse ───────────────────────────────────────────────────
const sidebarWidth = ref(240)
const sidebarCollapsed = ref(false)
const isResizing = ref(false)

let resizeStartX = 0
let resizeStartWidth = 0

const sidebarStyle = computed(() => ({
  width: sidebarCollapsed.value ? '20px' : `${sidebarWidth.value}px`,
  transition: isResizing.value ? 'none' : 'width 0.15s ease',
}))

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

function startResize(e: MouseEvent) {
  isResizing.value = true
  resizeStartX = e.clientX
  resizeStartWidth = sidebarWidth.value
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
}

function onResize(e: MouseEvent) {
  const delta = e.clientX - resizeStartX
  sidebarWidth.value = Math.max(120, Math.min(600, resizeStartWidth + delta))
}

function stopResize() {
  isResizing.value = false
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    saveCurrentFile()
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    if (activeFileType.value === 'pdf') {
      pdfRef.value?.openSearch()
    } else {
      editorRef.value?.openSearch()
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
    e.preventDefault()
    if (activeTabId.value) closeTab(activeTabId.value)
  }
}

// ── Save indicator ────────────────────────────────────────────────────────────
const saveStatus = computed(() => {
  const tab = activeTab.value
  if (!tab) return 'saved'
  return tab.isDirty ? 'unsaved' : 'saved'
})
</script>

<template>
  <div class="app" @keydown="handleKeydown" tabindex="-1">
    <div class="sidebar-container" :style="sidebarStyle">
      <FileSidebar
        v-show="!sidebarCollapsed"
        :active-file="activeFile"
        @file-selected="handleFileSelected($event, false)"
        @file-selected-new-tab="handleFileSelected($event, true)"
        @file-renamed="handleFileRenamed"
        @file-moved="handleFileRenamed"
        @folder-opened="handleFolderOpened"
        @folder-closed="handleFolderClosed"
        @toggle-collapse="toggleSidebar"
        @external-change="handleExternalChange"
      />
      <div v-if="sidebarCollapsed" class="sidebar-strip" @click="toggleSidebar" title="Expand sidebar">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/>
        </svg>
      </div>
    </div>

    <div
      v-show="!sidebarCollapsed"
      class="resize-handle"
      :class="{ resizing: isResizing }"
      @mousedown.prevent="startResize"
    />

    <div class="main">
      <TabBar
        :tabs="tabs"
        :active-tab-id="activeTabId"
        @activate="activateTab"
        @close="closeTab"
      />

      <div class="titlebar" v-if="activeFile && tabs.length === 0">
        <span class="file-name">{{ activeFile.split(/[\\/]/).pop() }}</span>
        <span class="save-indicator" :class="saveStatus">
          {{ saveStatus === 'saved' ? 'Saved' : '● Unsaved' }}
        </span>
      </div>

      <MarkdownEditor
        v-if="activeFileType === 'markdown' || activeFileType === 'text' || activeFileType === 'rst' || activeFileType === 'code'"
        ref="editorRef"
        :content="fileContent"
        :file-path="activeFile"
        :root-path="rootPath"
        @change="handleEditorChange"
        @navigate="handleNavigate"
      />
      <PdfViewer
        v-else-if="activeFileType === 'pdf'"
        ref="pdfRef"
        :file-path="activeFile"
      />
      <ImageViewer
        v-else-if="activeFileType === 'image'"
        :file-path="activeFile"
      />
    </div>
  </div>
</template>

<style>
/* ─── CSS Variables (theme) ──────────────────────────────────────────── */
:root {
  --bg: #1e1e2e;
  --sidebar-bg: #181825;
  --editor-bg: #1e1e2e;
  --border: #313244;
  --text: #cdd6f4;
  --text-muted: #6c7086;
  --hover-bg: #313244;
  --active-bg: #45475a;
  --active-line-bg: rgba(69, 71, 90, 0.35);
  --selection-bg: rgba(137, 180, 250, 0.25);
  --accent: #89b4fa;
  --code-bg: #313244;
  --code-fg: #f38ba8;
  --code-block-bg: #181825;
  --link-broken: #f38ba8;
  color-scheme: dark;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #eff1f5;
    --sidebar-bg: #e6e9ef;
    --editor-bg: #eff1f5;
    --border: #ccd0da;
    --text: #4c4f69;
    --text-muted: #8c8fa1;
    --hover-bg: #dce0e8;
    --active-bg: #ccd0da;
    --active-line-bg: rgba(204, 208, 218, 0.4);
    --selection-bg: rgba(30, 102, 245, 0.2);
    --accent: #1e66f5;
    --code-bg: #ccd0da;
    --code-fg: #d20f39;
    --code-block-bg: #dce0e8;
    --link-broken: #d20f39;
    color-scheme: light;
  }
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body, #app {
  height: 100%;
  overflow: hidden;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  overflow: hidden;
  outline: none;
}

.sidebar-container {
  display: flex;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}

.sidebar-strip {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  color: var(--text-muted);
  transition: background 0.1s, color 0.1s;
}

.sidebar-strip:hover {
  background: var(--hover-bg);
  color: var(--text);
}

.resize-handle {
  width: 4px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
}

.resize-handle:hover,
.resize-handle.resizing {
  background: var(--accent);
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  background: var(--editor-bg);
  flex-shrink: 0;
}

.file-name {
  font-weight: 500;
  color: var(--text);
}

.save-indicator {
  font-size: 11px;
  color: var(--text-muted);
  transition: color 0.2s;
}

.save-indicator.unsaved {
  color: #fab387;
}

.save-indicator.saved {
  color: #a6e3a1;
}
</style>
