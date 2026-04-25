<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

interface FileEntry {
  name: string
  path: string
  is_dir: boolean
  children?: FileEntry[] | null
}

defineProps<{
  activeFile: string | null
}>()

const emit = defineEmits<{
  fileSelected: [path: string]
  fileRenamed: [oldPath: string, newPath: string]
  folderOpened: [path: string]
}>()

const rootPath = ref<string | null>(null)
const files = ref<FileEntry[]>([])
// Map of path -> loaded children (reactive)
const childrenMap = ref<Map<string, FileEntry[]>>(new Map())
const expandedDirs = ref<Set<string>>(new Set())
const error = ref<string | null>(null)

async function openFolderPath(path: string) {
  rootPath.value = path
  childrenMap.value = new Map()
  expandedDirs.value = new Set()
  await loadDirectory(path, true)
  emit('folderOpened', path)
}

async function openFolder() {
  const selected = await open({ directory: true, multiple: false })
  if (selected && typeof selected === 'string') {
    await openFolderPath(selected)
  }
}

onMounted(async () => {
  const initial = await invoke<string | null>('get_initial_folder')
  if (initial) await openFolderPath(initial)
})

async function loadDirectory(path: string, isRoot = false): Promise<FileEntry[]> {
  try {
    const entries: FileEntry[] = await invoke('list_directory', { path })
    if (isRoot) {
      files.value = entries
    } else {
      childrenMap.value = new Map(childrenMap.value).set(path, entries)
    }
    return entries
  } catch (e) {
    error.value = String(e)
    return []
  }
}

async function toggleDir(entry: FileEntry) {
  if (!entry.is_dir) return
  if (expandedDirs.value.has(entry.path)) {
    const next = new Set(expandedDirs.value)
    next.delete(entry.path)
    expandedDirs.value = next
  } else {
    // Load children if not yet cached
    if (!childrenMap.value.has(entry.path)) {
      await loadDirectory(entry.path)
    }
    const next = new Set(expandedDirs.value)
    next.add(entry.path)
    expandedDirs.value = next
  }
}

function selectFile(entry: FileEntry) {
  if (!entry.is_dir) {
    emit('fileSelected', entry.path)
  }
}

async function renameEntry(entry: FileEntry, newName: string) {
  const oldPath = entry.path
  const sep = oldPath.includes('\\') ? '\\' : '/'
  const lastSep = Math.max(oldPath.lastIndexOf('\\'), oldPath.lastIndexOf('/'))
  const parentPath = lastSep >= 0 ? oldPath.substring(0, lastSep) : ''
  const newPath = `${parentPath}${sep}${newName}`
  try {
    await invoke('rename_file', { oldPath: entry.path, newPath })
    // Reload the relevant directory
    const dirPath = parentPath || rootPath.value!
    if (dirPath === rootPath.value) {
      await loadDirectory(dirPath, true)
    } else {
      await loadDirectory(dirPath)
    }
    emit('fileRenamed', entry.path, newPath)
  } catch (e) {
    alert(String(e))
  }
}

function handleRenameRequest(p: { entry: FileEntry; newName: string }) {
  renameEntry(p.entry, p.newName)
}

async function newFile() {
  if (!rootPath.value) return
  const name = prompt('File name (without .md):')
  if (!name) return
  const path = `${rootPath.value}/${name}.md`
  try {
    await invoke('create_file', { path })
    await loadDirectory(rootPath.value, true)
    emit('fileSelected', path)
  } catch (e) {
    alert(String(e))
  }
}

const folderName = computed(() => {
  if (!rootPath.value) return null
  return rootPath.value.split(/[\\/]/).pop() ?? rootPath.value
})
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">{{ folderName ?? 'No folder open' }}</span>
      <div class="sidebar-actions">
        <button class="icon-btn" title="New file" @click="newFile" v-if="rootPath">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"/>
          </svg>
        </button>
        <button class="icon-btn" title="Open folder" @click="openFolder">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/>
          </svg>
        </button>
      </div>
    </div>

    <div v-if="!rootPath" class="sidebar-empty">
      <button class="open-btn" @click="openFolder">Open Folder</button>
    </div>

    <div v-else class="file-tree">
      <FileTreeNode
        v-for="entry in files"
        :key="entry.path"
        :entry="entry"
        :active-file="activeFile"
        :expanded-dirs="expandedDirs"
        :children-map="childrenMap"
        :depth="0"
        @toggle-dir="toggleDir"
        @select-file="selectFile"
        @rename-request="handleRenameRequest"
      />
    </div>
  </aside>
</template>

<script lang="ts">
// Recursive tree node as a local sub-component via defineComponent
</script>

<style scoped>
.sidebar {
  width: 240px;
  min-width: 180px;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.sidebar-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 3px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, color 0.1s;
}

.icon-btn:hover {
  background: var(--hover-bg);
  color: var(--text);
}

.sidebar-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.open-btn {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 5px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.open-btn:hover {
  opacity: 0.85;
}

.file-tree {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
</style>
