<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
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
  toggleCollapse: []
}>()

const rootPath = ref<string | null>(null)
const files = ref<FileEntry[]>([])
const childrenMap = ref<Map<string, FileEntry[]>>(new Map())
const expandedDirs = ref<Set<string>>(new Set())
const error = ref<string | null>(null)
const filterText = ref('')

async function openFolderPath(path: string) {
  rootPath.value = path
  childrenMap.value = new Map()
  expandedDirs.value = new Set()
  filterText.value = ''
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

// Recursively load all directories so the filter can search them.
async function loadAllSubdirectories(entries: FileEntry[]) {
  for (const entry of entries) {
    if (!entry.is_dir) continue
    if (!childrenMap.value.has(entry.path)) {
      const children = await loadDirectory(entry.path)
      await loadAllSubdirectories(children)
    } else {
      await loadAllSubdirectories(childrenMap.value.get(entry.path)!)
    }
  }
}

watch(filterText, async (text) => {
  if (text.trim() && rootPath.value) {
    await loadAllSubdirectories(files.value)
  }
})

// Returns filtered root entries and populates outMap with filtered children.
function buildFilteredTree(entries: FileEntry[], lower: string, outMap: Map<string, FileEntry[]>): FileEntry[] {
  const result: FileEntry[] = []
  for (const entry of entries) {
    if (entry.is_dir) {
      const children = childrenMap.value.get(entry.path) ?? []
      if (entry.name.toLowerCase().includes(lower)) {
        // Folder name matches — show it with all its children
        outMap.set(entry.path, children)
        result.push(entry)
      } else {
        const filteredChildren = buildFilteredTree(children, lower, outMap)
        if (filteredChildren.length > 0) {
          outMap.set(entry.path, filteredChildren)
          result.push(entry)
        }
      }
    } else {
      if (entry.name.replace(/\.md$/, '').toLowerCase().includes(lower)) {
        result.push(entry)
      }
    }
  }
  return result
}

const filterResult = computed(() => {
  const text = filterText.value.trim()
  if (!text) return null
  const lower = text.toLowerCase()
  const outMap = new Map<string, FileEntry[]>()
  const filteredFiles = buildFilteredTree(files.value, lower, outMap)
  return {
    files: filteredFiles,
    childrenMap: outMap,
    expandedDirs: new Set(outMap.keys()),
  }
})

const displayFiles = computed(() => filterResult.value?.files ?? files.value)
const displayChildrenMap = computed(() => filterResult.value?.childrenMap ?? childrenMap.value)
const displayExpandedDirs = computed(() => filterResult.value?.expandedDirs ?? expandedDirs.value)

async function toggleDir(entry: FileEntry) {
  if (!entry.is_dir) return
  // Ignore toggle while filtering — dirs are kept auto-expanded by filterResult
  if (filterResult.value) return
  if (expandedDirs.value.has(entry.path)) {
    const next = new Set(expandedDirs.value)
    next.delete(entry.path)
    expandedDirs.value = next
  } else {
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
        <button class="icon-btn" title="Collapse sidebar" @click="emit('toggleCollapse')">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z"/>
          </svg>
        </button>
      </div>
    </div>

    <div v-if="!rootPath" class="sidebar-empty">
      <button class="open-btn" @click="openFolder">Open Folder</button>
    </div>

    <template v-else>
      <div class="file-tree">
        <div v-if="filterResult && displayFiles.length === 0" class="filter-empty">
          No matches
        </div>
        <FileTreeNode
          v-for="entry in displayFiles"
          :key="entry.path"
          :entry="entry"
          :active-file="activeFile"
          :expanded-dirs="displayExpandedDirs"
          :children-map="displayChildrenMap"
          :depth="0"
          @toggle-dir="toggleDir"
          @select-file="selectFile"
          @rename-request="handleRenameRequest"
        />
      </div>

      <div class="sidebar-filter">
        <svg class="filter-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
          <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
        </svg>
        <input
          v-model="filterText"
          class="filter-input"
          placeholder="Filter..."
          type="text"
          spellcheck="false"
        />
        <button v-if="filterText" class="filter-clear" @click="filterText = ''" title="Clear filter">
          <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor">
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
          </svg>
        </button>
      </div>
    </template>
  </aside>
</template>

<script lang="ts">
// Recursive tree node as a local sub-component via defineComponent
</script>

<style scoped>
.sidebar {
  width: 100%;
  height: 100%;
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

.filter-empty {
  padding: 12px 12px;
  font-size: 12px;
  color: var(--text-muted);
}

.sidebar-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.filter-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.filter-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  font-size: 12px;
  font-family: inherit;
  color: var(--text);
}

.filter-input::placeholder {
  color: var(--text-muted);
}

.filter-clear {
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
  transition: background 0.1s, color 0.1s;
}

.filter-clear:hover {
  background: var(--hover-bg);
  color: var(--text);
}
</style>
