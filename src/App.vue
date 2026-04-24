<script setup lang="ts">
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import FileSidebar from './components/FileSidebar.vue'
import MarkdownEditor from './components/MarkdownEditor.vue'

const activeFile = ref<string | null>(null)
const rootPath = ref('')
const fileContent = ref('')
const isDirty = ref(false)
const saveStatus = ref<'saved' | 'saving' | 'unsaved'>('saved')

let saveTimer: ReturnType<typeof setTimeout> | null = null

function handleFolderOpened(path: string) {
  rootPath.value = path
}

function handleFileRenamed(oldPath: string, newPath: string) {
  if (activeFile.value === oldPath) {
    activeFile.value = newPath
  }
}

async function handleFileSelected(path: string) {
  if (isDirty.value) {
    await saveCurrentFile()
  }
  try {
    const content = await invoke<string>('read_file', { path })
    // Set both together so the editor never sees a mismatched filePath+content
    fileContent.value = content
    activeFile.value = path
    isDirty.value = false
    saveStatus.value = 'saved'
  } catch (e) {
    console.error('Failed to read file:', e)
    fileContent.value = ''
    activeFile.value = path
  }
}

function handleEditorChange(content: string) {
  fileContent.value = content
  isDirty.value = true
  saveStatus.value = 'unsaved'

  // Debounced auto-save
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveCurrentFile()
  }, 800)
}

async function saveCurrentFile() {
  if (!activeFile.value || !isDirty.value) return
  saveStatus.value = 'saving'
  try {
    await invoke('write_file', { path: activeFile.value, content: fileContent.value })
    isDirty.value = false
    saveStatus.value = 'saved'
  } catch (e) {
    console.error('Failed to save file:', e)
    saveStatus.value = 'unsaved'
  }
}

// Keyboard shortcut Ctrl/Cmd+S
function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    saveCurrentFile()
  }
}

const fileName = (path: string | null) => {
  if (!path) return ''
  return path.split(/[\\/]/).pop() ?? path
}
</script>

<template>
  <div class="app" @keydown="handleKeydown" tabindex="-1">
    <FileSidebar
      :active-file="activeFile"
      @file-selected="handleFileSelected"
      @file-renamed="handleFileRenamed"
      @folder-opened="handleFolderOpened"
    />

    <div class="main">
      <div class="titlebar" v-if="activeFile">
        <span class="file-name">{{ fileName(activeFile) }}</span>
        <span class="save-indicator" :class="saveStatus">
          {{ saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : '● Unsaved' }}
        </span>
      </div>

      <MarkdownEditor
        :content="fileContent"
        :file-path="activeFile"
        :root-path="rootPath"
        @change="handleEditorChange"
        @navigate="handleFileSelected"
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

.save-indicator.saving {
  color: var(--text-muted);
}

.save-indicator.saved {
  color: #a6e3a1;
}
</style>
