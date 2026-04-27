<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const props = defineProps<{ filePath: string | null }>()

// ── State ──────────────────────────────────────────────────────────────────────
const loading = ref(false)
const error = ref<string | null>(null)
const src = ref<string | null>(null)        // data URL or SVG blob URL
const isSvg = ref(false)

const scale = ref(1)
const rotation = ref(0)   // degrees, multiples of 90
const offsetX = ref(0)
const offsetY = ref(0)
const fitScale = ref(1)   // scale that makes the image fit the viewport

// ── Load image ────────────────────────────────────────────────────────────────
const containerRef = ref<HTMLDivElement | null>(null)
let blobUrl: string | null = null

function mime(path: string): string {
  if (path.endsWith('.svg'))  return 'image/svg+xml'
  if (path.endsWith('.png'))  return 'image/png'
  if (path.endsWith('.gif'))  return 'image/gif'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.avif')) return 'image/avif'
  return 'image/jpeg'
}

function revokeBlobUrl() {
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null }
}

async function load(path: string) {
  revokeBlobUrl()
  src.value = null
  error.value = null
  loading.value = true
  scale.value = 1
  rotation.value = 0
  offsetX.value = 0
  offsetY.value = 0

  try {
    if (path.endsWith('.svg')) {
      isSvg.value = true
      const text = await invoke<string>('read_file', { path })
      const blob = new Blob([text], { type: 'image/svg+xml' })
      blobUrl = URL.createObjectURL(blob)
      src.value = blobUrl
    } else {
      isSvg.value = false
      const b64 = await invoke<string>('read_file_base64', { path })
      src.value = `data:${mime(path)};base64,${b64}`
    }
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}

watch(() => props.filePath, (p) => { if (p) load(p) }, { immediate: true })
onUnmounted(revokeBlobUrl)

// ── Natural size → fit scale ──────────────────────────────────────────────────
function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  const cw = containerRef.value?.clientWidth ?? img.naturalWidth
  const ch = containerRef.value?.clientHeight ?? img.naturalHeight
  const sw = cw / img.naturalWidth
  const sh = ch / img.naturalHeight
  fitScale.value = Math.min(sw, sh, 1)   // never upscale beyond 1x by default
  scale.value = fitScale.value
  offsetX.value = 0
  offsetY.value = 0
}

// ── Zoom ──────────────────────────────────────────────────────────────────────
const ZOOM_STEP = 0.15
const MIN_SCALE = 0.05
const MAX_SCALE = 10

function zoomIn()    { scale.value = Math.min(MAX_SCALE, scale.value * (1 + ZOOM_STEP)) }
function zoomOut()   { scale.value = Math.max(MIN_SCALE, scale.value / (1 + ZOOM_STEP)) }
function resetZoom() { scale.value = fitScale.value; offsetX.value = 0; offsetY.value = 0 }
function zoom100()   { scale.value = 1 }

const zoomLabel = computed(() => `${Math.round(scale.value * 100)}%`)

// Wheel zoom centred on pointer
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const factor = e.deltaY < 0 ? (1 + ZOOM_STEP) : 1 / (1 + ZOOM_STEP)
  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor))
  if (newScale === scale.value) return

  // Zoom towards the pointer
  const rect = containerRef.value!.getBoundingClientRect()
  const px = e.clientX - rect.left - rect.width / 2
  const py = e.clientY - rect.top - rect.height / 2
  const ratio = newScale / scale.value
  offsetX.value = px + (offsetX.value - px) * ratio
  offsetY.value = py + (offsetY.value - py) * ratio
  scale.value = newScale
}

// ── Rotate ────────────────────────────────────────────────────────────────────
function rotateCW()  { rotation.value = (rotation.value + 90) % 360 }
function rotateCCW() { rotation.value = (rotation.value - 90 + 360) % 360 }

// ── Pan ───────────────────────────────────────────────────────────────────────
let isPanning = false
let panStartX = 0
let panStartY = 0
let panOriginX = 0
let panOriginY = 0

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  isPanning = true
  panStartX = e.clientX
  panStartY = e.clientY
  panOriginX = offsetX.value
  panOriginY = offsetY.value
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!isPanning) return
  offsetX.value = panOriginX + (e.clientX - panStartX)
  offsetY.value = panOriginY + (e.clientY - panStartY)
}

function onPointerUp(e: PointerEvent) {
  isPanning = false
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
}

// ── Image transform ───────────────────────────────────────────────────────────
// The <img> is placed at top:50%/left:50% in CSS, so we must first offset by
// -50%/-50% of its own size, then apply pan offset, rotate, scale.
const imgStyle = computed(() => ({
  transform: `translate(calc(-50% + ${offsetX.value}px), calc(-50% + ${offsetY.value}px)) rotate(${rotation.value}deg) scale(${scale.value})`,
  transformOrigin: 'center center',
  cursor: isPanning ? 'grabbing' : 'grab',
  userSelect: 'none' as const,
  maxWidth: 'none',
  maxHeight: 'none',
}))
</script>

<template>
  <div class="img-wrap">
    <!-- Toolbar -->
    <div class="img-toolbar">
      <div class="img-toolbar-group">
        <button class="img-tool-btn" title="Zoom out (scroll down)" @click="zoomOut">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M6.5 1a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM0 6.5a6.5 6.5 0 1 1 11.743 3.836l3.21 3.21a.75.75 0 1 1-1.06 1.061l-3.21-3.21A6.5 6.5 0 0 1 0 6.5Zm3.75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Z"/>
          </svg>
        </button>
        <span class="img-zoom-label" @click="zoom100" title="Click for 100%">{{ zoomLabel }}</span>
        <button class="img-tool-btn" title="Zoom in (scroll up)" @click="zoomIn">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M6.5 1a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM0 6.5a6.5 6.5 0 1 1 11.743 3.836l3.21 3.21a.75.75 0 1 1-1.06 1.061l-3.21-3.21A6.5 6.5 0 0 1 0 6.5Zm6.5-3.25v2.5h2.5a.75.75 0 0 1 0 1.5H6.5v2.5a.75.75 0 0 1-1.5 0v-2.5H2.75a.75.75 0 0 1 0-1.5H5v-2.5a.75.75 0 0 1 1.5 0Z"/>
          </svg>
        </button>
        <button class="img-tool-btn img-tool-btn--text" title="Reset zoom &amp; position" @click="resetZoom">Fit</button>
      </div>

      <div class="img-toolbar-group">
        <button class="img-tool-btn" title="Rotate counter-clockwise" @click="rotateCCW">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"/>
          </svg>
        </button>
        <button class="img-tool-btn" title="Rotate clockwise" @click="rotateCW">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M14.295 8.005a.75.75 0 0 0-.834.656 5.5 5.5 0 0 1-9.592 2.97l1.204-1.204a.25.25 0 0 0-.177-.427H1.25a.25.25 0 0 0-.25.25v3.646a.25.25 0 0 0 .427.177l1.38-1.38A7.002 7.002 0 0 0 14.95 8.84a.75.75 0 0 0-.656-.834ZM8 2.5a5.487 5.487 0 0 1 4.131 1.869l-1.204 1.204a.25.25 0 0 0 .177.427h3.646a.25.25 0 0 0 .25-.25V2.104a.25.25 0 0 0-.427-.177l-1.38 1.38A7.002 7.002 0 0 0 1.05 7.16a.75.75 0 0 0 1.49.178A5.5 5.5 0 0 1 8 2.5Z"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Image canvas -->
    <div
      ref="containerRef"
      class="img-canvas"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div v-if="loading" class="img-state">Loading…</div>
      <div v-else-if="error" class="img-state img-state--error">{{ error }}</div>
      <img
        v-else-if="src"
        :src="src"
        :style="imgStyle"
        draggable="false"
        @load="onImageLoad"
      />
    </div>
  </div>
</template>

<style scoped>
.img-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  background: var(--editor-bg);
}

/* ── Toolbar ── */
.img-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 36px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  background: var(--editor-bg);
  gap: 8px;
}

.img-toolbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.img-tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  padding: 4px 6px;
  line-height: 1;
  transition: background 0.1s, color 0.1s;
}

.img-tool-btn:hover {
  background: var(--hover-bg);
  color: var(--text);
}

.img-tool-btn--text {
  font-size: 12px;
  padding: 3px 8px;
}

.img-zoom-label {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 44px;
  text-align: center;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.1s, color 0.1s;
}

.img-zoom-label:hover {
  background: var(--hover-bg);
  color: var(--text);
}

/* ── Canvas ── */
.img-canvas {
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.img-canvas img {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-origin: center center;
}

.img-state {
  color: var(--text-muted);
  font-size: 13px;
}

.img-state--error {
  color: #f38ba8;
}
</style>
