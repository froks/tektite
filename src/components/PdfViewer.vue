<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import * as pdfjsLib from 'pdfjs-dist'

// Point the worker at the bundled worker file via Vite's ?url import
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const props = defineProps<{
  filePath: string | null
}>()

// ── State ─────────────────────────────────────────────────────────────────────
const containerRef = ref<HTMLDivElement | null>(null)
const scrollRef = ref<HTMLDivElement | null>(null)
const error = ref<string | null>(null)
const isLoading = ref(false)
const pageCount = ref(0)
const currentPage = ref(1)
const scale = ref(1.4)

// Search state
const searchVisible = ref(false)
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const matchIndex = ref(0)
const matchCount = ref(0)

let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null
// Rendered canvas per page (1-indexed)
const canvasRefs: HTMLCanvasElement[] = []
// Map pageNum → rendered textLayer div
const textLayerDivs: HTMLDivElement[] = []
// PDF.js TextLayer instances
const textLayers: pdfjsLib.TextLayer[] = []
// Keep track of highlights so we can clear them
let highlightSpans: HTMLElement[] = []

// ── Load PDF ──────────────────────────────────────────────────────────────────
async function loadPdf(path: string) {
  error.value = null
  isLoading.value = true
  pageCount.value = 0
  currentPage.value = 1
  canvasRefs.length = 0
  textLayerDivs.length = 0
  textLayers.length = 0
  highlightSpans = []

  try {
    const base64 = await invoke<string>('read_file_base64', { path })
    // Convert base64 to Uint8Array
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null }
    pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise
    pageCount.value = pdfDoc.numPages
    isLoading.value = false
    await nextTick()
    await renderAllPages()
  } catch (e) {
    isLoading.value = false
    error.value = String(e)
  }
}

async function renderAllPages() {
  if (!pdfDoc || !containerRef.value) return
  const container = containerRef.value

  // Clear previous render
  container.innerHTML = ''
  canvasRefs.length = 0
  textLayerDivs.length = 0
  textLayers.length = 0

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale: scale.value })

    // Wrapper div per page
    const wrapper = document.createElement('div')
    wrapper.className = 'pdf-page'
    wrapper.style.width = `${viewport.width}px`
    wrapper.style.height = `${viewport.height}px`
    wrapper.dataset.page = String(pageNum)

    // Canvas
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.display = 'block'
    wrapper.appendChild(canvas)
    canvasRefs[pageNum] = canvas

    // Text layer div (for selection and search highlighting)
    const textDiv = document.createElement('div')
    textDiv.className = 'pdf-text-layer'
    textDiv.style.width = `${viewport.width}px`
    textDiv.style.height = `${viewport.height}px`
    wrapper.appendChild(textDiv)
    textLayerDivs[pageNum] = textDiv

    container.appendChild(wrapper)

    // Render canvas
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, canvas, viewport }).promise

    // Render text layer
    const textContent = await page.getTextContent()
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textDiv,
      viewport,
    })
    await textLayer.render()
    textLayers[pageNum] = textLayer
  }
}

// ── Zoom ──────────────────────────────────────────────────────────────────────
async function zoomIn() {
  scale.value = Math.min(4, +(scale.value + 0.2).toFixed(1))
  await renderAllPages()
}

async function zoomOut() {
  scale.value = Math.max(0.4, +(scale.value - 0.2).toFixed(1))
  await renderAllPages()
}

async function zoomReset() {
  scale.value = 1.4
  await renderAllPages()
}

// ── Search ────────────────────────────────────────────────────────────────────
function clearHighlights() {
  for (const span of highlightSpans) {
    span.classList.remove('pdf-highlight', 'pdf-highlight--current')
  }
  highlightSpans = []
}

async function runSearch(query: string) {
  clearHighlights()
  matchIndex.value = 0
  matchCount.value = 0
  if (!query.trim() || !pdfDoc) return

  const lower = query.toLowerCase()
  const allMatches: HTMLElement[] = []

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const textDiv = textLayerDivs[pageNum]
    if (!textDiv) continue
    const spans = textDiv.querySelectorAll<HTMLElement>('span[role="presentation"], span')
    for (const span of spans) {
      const text = span.textContent ?? ''
      if (text.toLowerCase().includes(lower)) {
        span.classList.add('pdf-highlight')
        allMatches.push(span)
      }
    }
  }

  highlightSpans = allMatches
  matchCount.value = allMatches.length
  if (allMatches.length > 0) {
    goToMatch(0)
  }
}

function goToMatch(idx: number) {
  if (highlightSpans.length === 0) return
  for (const s of highlightSpans) s.classList.remove('pdf-highlight--current')
  matchIndex.value = ((idx % highlightSpans.length) + highlightSpans.length) % highlightSpans.length
  const el = highlightSpans[matchIndex.value]
  el.classList.add('pdf-highlight--current')

  // Scroll within the pdf-scroll container only — do NOT use scrollIntoView
  // which can escape the container and shift the outer app layout.
  const scroll = scrollRef.value
  if (!scroll) return
  const elRect = el.getBoundingClientRect()
  const scrollRect = scroll.getBoundingClientRect()
  const relTop = elRect.top - scrollRect.top + scroll.scrollTop
  const targetScrollTop = relTop - (scroll.clientHeight / 2) + (elRect.height / 2)
  scroll.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
}

function searchNext() { goToMatch(matchIndex.value + 1) }
function searchPrev() { goToMatch(matchIndex.value - 1) }

function closeSearch() {
  searchVisible.value = false
  searchQuery.value = ''
  clearHighlights()
  matchCount.value = 0
}

// Exposed so App.vue can open search via Ctrl+F
function openSearch() {
  searchVisible.value = true
  nextTick(() => searchInput.value?.focus())
}
defineExpose({ openSearch })

// ── Scroll-based current page tracking ───────────────────────────────────────
function handleScroll() {
  if (!containerRef.value || !scrollRef.value) return
  const scrollTop = scrollRef.value.scrollTop
  const wrappers = containerRef.value.querySelectorAll<HTMLDivElement>('.pdf-page')
  let best = 1
  for (const w of wrappers) {
    if ((w.offsetTop - 80) <= scrollTop) {
      best = Number(w.dataset.page ?? 1)
    }
  }
  currentPage.value = best
}

// ── Watchers & lifecycle ──────────────────────────────────────────────────────
watch(() => props.filePath, (path) => {
  if (path) loadPdf(path)
  else {
    if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null }
    if (containerRef.value) containerRef.value.innerHTML = ''
    pageCount.value = 0
  }
})

watch(searchQuery, (q) => runSearch(q))

onMounted(() => {
  if (props.filePath) loadPdf(props.filePath)
})

onUnmounted(() => {
  if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null }
})
</script>

<template>
  <div class="pdf-wrap">
    <!-- Toolbar -->
    <div class="pdf-toolbar">
      <span class="pdf-page-info" v-if="pageCount > 0">
        Page {{ currentPage }} / {{ pageCount }}
      </span>
      <div class="pdf-zoom-controls">
        <button class="pdf-tool-btn" @click="zoomOut" title="Zoom out">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
            <path d="M5.25 6.5h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5Z"/>
          </svg>
        </button>
        <span class="pdf-zoom-label">{{ Math.round(scale * 100) }}%</span>
        <button class="pdf-tool-btn" @click="zoomIn" title="Zoom in">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
            <path d="M7.25 5.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5H8v1.5a.75.75 0 0 1-1.5 0V9h-1.5a.75.75 0 0 1 0-1.5h1.5v-1.5a.75.75 0 0 1 .75-.75Z"/>
          </svg>
        </button>
        <button class="pdf-tool-btn" @click="zoomReset" title="Reset zoom">Reset</button>
      </div>
    </div>

    <!-- Search bar -->
    <div v-if="searchVisible" class="pdf-search-bar">
      <input
        ref="searchInput"
        v-model="searchQuery"
        class="pdf-search-input"
        placeholder="Find in PDF…"
        spellcheck="false"
        @keydown.enter.prevent="searchNext"
        @keydown.escape.prevent="closeSearch"
      />
      <span class="pdf-search-count" v-if="searchQuery">
        {{ matchCount === 0 ? 'No results' : `${matchIndex + 1} / ${matchCount}` }}
      </span>
      <button class="pdf-search-nav" @click="searchPrev" :disabled="matchCount === 0" title="Previous">↑</button>
      <button class="pdf-search-nav" @click="searchNext" :disabled="matchCount === 0" title="Next">↓</button>
      <button class="pdf-search-close" @click="closeSearch" title="Close">
        <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
        </svg>
      </button>
    </div>

    <!-- Scroll container -->
    <div ref="scrollRef" class="pdf-scroll" @scroll="handleScroll">
      <div v-if="isLoading" class="pdf-loading">Loading…</div>
      <div v-else-if="error" class="pdf-error">{{ error }}</div>
      <div v-else ref="containerRef" class="pdf-pages" />
    </div>
  </div>
</template>

<style scoped>
.pdf-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

/* ── Toolbar ── */
.pdf-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--editor-bg);
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-muted);
  gap: 12px;
}

.pdf-page-info {
  font-size: 12px;
}

.pdf-zoom-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pdf-zoom-label {
  min-width: 38px;
  text-align: center;
  font-size: 12px;
  color: var(--text);
}

.pdf-tool-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 3px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  font-size: 12px;
  font-family: inherit;
  transition: background 0.1s, color 0.1s;
}

.pdf-tool-btn:hover {
  background: var(--hover-bg);
  color: var(--text);
}

/* ── Search bar ── */
.pdf-search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--editor-bg);
  flex-shrink: 0;
}

.pdf-search-input {
  flex: 1;
  max-width: 260px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 4px 8px;
  font-size: 12px;
  font-family: inherit;
  color: var(--text);
  outline: none;
  transition: border-color 0.15s;
}

.pdf-search-input:focus {
  border-color: var(--accent);
}

.pdf-search-count {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.pdf-search-nav {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 13px;
  transition: background 0.1s, color 0.1s;
}

.pdf-search-nav:hover:not(:disabled) {
  background: var(--hover-bg);
  color: var(--text);
}

.pdf-search-nav:disabled {
  opacity: 0.35;
  cursor: default;
}

.pdf-search-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 4px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  transition: background 0.1s, color 0.1s;
}

.pdf-search-close:hover {
  background: var(--hover-bg);
  color: var(--text);
}

/* ── Scroll area ── */
.pdf-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  padding: 24px;
  display: flex;
  justify-content: center;
}

.pdf-pages {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
}

.pdf-loading,
.pdf-error {
  color: var(--text-muted);
  font-size: 13px;
  padding: 40px;
}

.pdf-error {
  color: var(--link-broken);
}
</style>

<!-- Global styles for PDF page wrappers (not scoped, since they're created dynamically) -->
<style>
.pdf-page {
  position: relative;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
}

.pdf-text-layer {
  position: absolute;
  top: 0;
  left: 0;
  overflow: hidden;
  opacity: 1;
  line-height: 1;
  pointer-events: auto;
}

/* PDF.js text layer spans */
.pdf-text-layer span {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}

.pdf-text-layer ::selection {
  background: var(--selection-bg);
  color: transparent;
}

/* Search highlights */
.pdf-highlight {
  background: rgba(250, 179, 135, 0.35) !important;
  color: transparent !important;
  border-radius: 2px;
}

.pdf-highlight--current {
  background: rgba(137, 180, 250, 0.55) !important;
  outline: 1px solid var(--accent);
}
</style>
