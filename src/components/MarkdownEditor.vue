<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { EditorView, keymap, drawSelection, highlightActiveLine, dropCursor, Decoration } from '@codemirror/view'
import { EditorState, StateEffect, StateField, RangeSetBuilder } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { php } from '@codemirror/lang-php'
import { createMarkdownDecorations } from '../editor/markdownDecorations'
import SearchPanel from './SearchPanel.vue'

// Replace the language-data PHP entry (which calls php() without plain:true and
// therefore expects a <?php opening tag) with one that uses plain:true so that
// code fences containing raw PHP without <?php are highlighted correctly.
const phpPlain = LanguageDescription.of({
  name: 'PHP',
  alias: ['php'],
  extensions: ['php', 'php3', 'php4', 'php5', 'php7', 'phtml'],
  support: php({ plain: true }),
})
const codeLanguages = [phpPlain, ...languages.filter(l => l.name !== 'PHP')]

const props = defineProps<{
  content: string
  filePath: string | null
  rootPath: string
}>()

const emit = defineEmits<{
  change: [content: string]
  navigate: [path: string]
}>()

const editorEl = ref<HTMLElement | null>(null)
const searchPanelRef = ref<InstanceType<typeof SearchPanel> | null>(null)
let view: EditorView | null = null
let internalUpdate = false

// --- Search ---

interface SearchMatch { from: number; to: number }
interface SearchState { query: string; matches: SearchMatch[]; currentIndex: number }

function findAllMatches(text: string, query: string): SearchMatch[] {
  if (!query) return []
  const lower = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const len = lowerQuery.length
  const matches: SearchMatch[] = []
  let pos = 0
  while (pos <= lower.length - len) {
    const idx = lower.indexOf(lowerQuery, pos)
    if (idx === -1) break
    matches.push({ from: idx, to: idx + len })
    pos = idx + 1
  }
  return matches
}

const setSearchEffect = StateEffect.define<SearchState | null>()

const searchHighlightField = StateField.define<SearchState | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSearchEffect)) return e.value
    }
    if (value?.query && tr.docChanged) {
      const matches = findAllMatches(tr.state.doc.toString(), value.query)
      const currentIndex = matches.length > 0 ? Math.min(value.currentIndex, matches.length - 1) : 0
      return { ...value, matches, currentIndex }
    }
    return value
  },
  provide: field =>
    EditorView.decorations.from(field, state => {
      if (!state?.matches.length) return Decoration.none
      const builder = new RangeSetBuilder<Decoration>()
      for (let i = 0; i < state.matches.length; i++) {
        const m = state.matches[i]
        builder.add(m.from, m.to, Decoration.mark({
          class: i === state.currentIndex ? 'search-match--active' : 'search-match',
        }))
      }
      return builder.finish()
    }),
})

const searchOpen = ref(false)
const searchQuery = ref('')
const searchMatchCount = ref(0)
const searchCurrentIndex = ref(-1)

function applySearchQuery(query: string, index = 0) {
  if (!view) return
  if (!query.trim()) {
    view.dispatch({ effects: setSearchEffect.of(null) })
    searchMatchCount.value = 0
    searchCurrentIndex.value = -1
    return
  }
  const matches = findAllMatches(view.state.doc.toString(), query)
  const currentIndex = matches.length > 0 ? Math.min(index, matches.length - 1) : 0
  const newState: SearchState | null = matches.length ? { query, matches, currentIndex } : null
  const dispatchArgs: Parameters<EditorView['dispatch']>[0] = { effects: setSearchEffect.of(newState) }
  if (matches[currentIndex]) {
    dispatchArgs.selection = { anchor: matches[currentIndex].from }
    dispatchArgs.scrollIntoView = true
  }
  view.dispatch(dispatchArgs)
  searchMatchCount.value = matches.length
  searchCurrentIndex.value = matches.length > 0 ? currentIndex : -1
}

function openSearch() {
  const alreadyOpen = searchOpen.value
  searchOpen.value = true
  const selectedText = view && (() => {
    const sel = view!.state.selection.main
    if (!sel.empty) return view!.state.doc.sliceString(sel.from, sel.to)
    return ''
  })()
  nextTick(() => {
    const initial = alreadyOpen ? undefined : (selectedText || undefined)
    searchPanelRef.value?.focus(initial)
    if (initial) applySearchQuery(initial, 0)
  })
}

function handleSearchQuery(query: string) {
  searchQuery.value = query
  applySearchQuery(query, 0)
}

function findNext() {
  if (!view) return
  const state = view.state.field(searchHighlightField)
  if (!state?.matches.length) return
  const nextIndex = (state.currentIndex + 1) % state.matches.length
  const match = state.matches[nextIndex]
  view.dispatch({
    effects: setSearchEffect.of({ ...state, currentIndex: nextIndex }),
    selection: { anchor: match.from },
    scrollIntoView: true,
  })
  searchCurrentIndex.value = nextIndex
}

function findPrev() {
  if (!view) return
  const state = view.state.field(searchHighlightField)
  if (!state?.matches.length) return
  const prevIndex = (state.currentIndex - 1 + state.matches.length) % state.matches.length
  const match = state.matches[prevIndex]
  view.dispatch({
    effects: setSearchEffect.of({ ...state, currentIndex: prevIndex }),
    selection: { anchor: match.from },
    scrollIntoView: true,
  })
  searchCurrentIndex.value = prevIndex
}

function closeSearch() {
  searchOpen.value = false
  searchQuery.value = ''
  searchMatchCount.value = 0
  searchCurrentIndex.value = -1
  if (view) {
    view.dispatch({ effects: setSearchEffect.of(null) })
    view.focus()
  }
}

defineExpose({ openSearch })

const markdownDecorations = createMarkdownDecorations({
  currentFilePath: () => props.filePath ?? '',
  rootPath: () => props.rootPath,
  onNavigate: (path) => emit('navigate', path),
  getView: () => view,
})

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '15px',
    fontFamily: "'Inter', system-ui, sans-serif",
    background: 'var(--editor-bg)',
    color: 'var(--text)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    padding: '24px 0',
    lineHeight: '1.7',
  },
  '.cm-content': {
    maxWidth: '780px',
    margin: '0 auto',
    padding: '0 32px',
    caretColor: 'var(--accent)',
  },
  '.cm-line': {
    padding: '0 2px',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground': {
    background: 'var(--selection-bg) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    background: 'var(--selection-bg) !important',
  },
  // CM6 puts the selection layer at z-index:-1 (behind .cm-content) so opaque
  // line backgrounds (e.g. code blocks) hide it. Raise it above content so
  // selections are visible everywhere. The layer uses an inline style, so
  // !important is required to win.
  '.cm-selectionLayer': {
    zIndex: '1 !important',
  },
  // Active line highlight
  '.cm-activeLine': {
    background: 'var(--active-line-bg)',
    borderRadius: '3px',
  },
  // Markdown styles
  '.md-hide': {
    fontSize: '0',
    width: '0',
  },
  '.md-h1': {
    fontSize: '2em',
    fontWeight: '700',
    lineHeight: '1.3',
    color: 'var(--text)',
  },
  '.md-h1 .cm-line, .cm-line.md-h1': {
    fontSize: '2em',
    fontWeight: '700',
    lineHeight: '1.3',
  },
  '.md-h2': {
    fontSize: '1.6em',
    fontWeight: '700',
    lineHeight: '1.35',
    color: 'var(--text)',
  },
  '.md-h2 .cm-line, .cm-line.md-h2': {
    fontSize: '1.6em',
    fontWeight: '700',
    lineHeight: '1.35',
  },
  '.md-h3': {
    fontSize: '1.3em',
    fontWeight: '600',
    lineHeight: '1.4',
    color: 'var(--text)',
  },
  '.md-h3 .cm-line, .cm-line.md-h3': {
    fontSize: '1.3em',
    fontWeight: '600',
    lineHeight: '1.4',
  },
  '.md-h4': {
    fontSize: '1.1em',
    fontWeight: '600',
    color: 'var(--text)',
  },
  '.md-h4 .cm-line, .cm-line.md-h4': {
    fontSize: '1.1em',
    fontWeight: '600',
  },
  '.md-h5': {
    fontSize: '1em',
    fontWeight: '600',
    color: 'var(--text)',
  },
  '.md-h6': {
    fontSize: '0.9em',
    fontWeight: '600',
    color: 'var(--text-muted)',
  },
  '.md-bold': {
    fontWeight: '700',
  },
  '.md-italic': {
    fontStyle: 'italic',
  },
  '.md-strike': {
    textDecoration: 'line-through',
    opacity: '0.6',
  },
  '.md-code-inline': {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: '0.88em',
    background: 'var(--code-bg)',
    padding: '1px 5px',
    borderRadius: '3px',
    color: 'var(--code-fg)',
  },
  '.md-codeblock-line': {
    background: 'var(--code-block-bg) !important',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: '0.9em',
    display: 'block',
    borderRadius: '0 !important',
  },
  '.md-codefence-anchor': {
    position: 'relative',
  },
  '.md-codefence-line': {
    background: 'var(--code-block-bg) !important',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: '0.9em',
    display: 'block',
    position: 'relative',
    borderRadius: '0 !important',
  },
  '.md-link-text': {
    color: 'var(--accent)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--accent)',
  },
  '.md-link-url': {
    color: 'var(--text-muted)',
    fontSize: '0.85em',
  },
  '.md-link-widget': {
    color: 'var(--accent)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--accent)',
    cursor: 'pointer',
  },
  '.md-link-widget--broken': {
    color: 'var(--link-broken)',
    textDecoration: 'underline',
    textDecorationStyle: 'dashed',
    textDecorationColor: 'var(--link-broken)',
    cursor: 'default',
  },
  '.md-blockquote-line': {
    color: 'var(--text-muted)',
    fontStyle: 'italic',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '3px 100%',
  },
  '.md-blockquote-depth-1': {
    backgroundImage: 'linear-gradient(var(--accent), var(--accent))',
    backgroundPosition: '0 0',
    paddingLeft: '11px',
  },
  '.md-blockquote-depth-2': {
    backgroundImage:
      'linear-gradient(var(--accent), var(--accent)), linear-gradient(var(--accent), var(--accent))',
    backgroundPosition: '0 0, 11px 0',
    paddingLeft: '22px',
  },
  '.md-blockquote-depth-3': {
    backgroundImage:
      'linear-gradient(var(--accent), var(--accent)), linear-gradient(var(--accent), var(--accent)), linear-gradient(var(--accent), var(--accent))',
    backgroundPosition: '0 0, 11px 0, 22px 0',
    paddingLeft: '33px',
  },
  '.md-blockquote-depth-4': {
    backgroundImage:
      'linear-gradient(var(--accent), var(--accent)), linear-gradient(var(--accent), var(--accent)), linear-gradient(var(--accent), var(--accent)), linear-gradient(var(--accent), var(--accent))',
    backgroundPosition: '0 0, 11px 0, 22px 0, 33px 0',
    paddingLeft: '44px',
  },
  '.md-blockquote-mark': {
    opacity: '0.35',
    fontStyle: 'normal',
  },
  '.md-hr-widget': {
    display: 'block',
    height: '1px',
    background: 'var(--border)',
    margin: '12px 0',
    width: '100%',
  },
  '.md-checkbox': {
    cursor: 'pointer',
    verticalAlign: 'middle',
    marginRight: '4px',
    accentColor: 'var(--accent)',
  },
  '.md-copy-btn': {
    position: 'absolute',
    top: '2px',
    right: '8px',
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '4px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: '1',
    transition: 'color 0.1s',
    zIndex: '10',
  },
  '.md-copy-btn:hover': {
    color: 'var(--text)',
  },
  // Table widget styles
  '.md-table-widget': {
    margin: '2px 0',
    display: 'block',
  },
  '.md-table-widget table': {
    borderCollapse: 'collapse',
    borderSpacing: '0',
  },
  '.md-table-widget th, .md-table-widget td': {
    padding: '4px 16px 4px 4px',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'pre',
  },
  '.md-table-widget thead th': {
    fontWeight: '700',
    borderBottom: '2px solid var(--border)',
  },
  '.search-match': {
    background: 'rgba(250, 179, 135, 0.3)',
    borderRadius: '2px',
  },
  '.search-match--active': {
    background: 'rgba(250, 179, 135, 0.65)',
    borderRadius: '2px',
    outline: '1px solid rgba(250, 179, 135, 0.9)',
  },
}, { dark: true })

// Catppuccin-based syntax highlight style (works for both Mocha dark and Latte light
// because the token colours are taken from their respective palettes and the theme
// switcher changes CSS variables at runtime — we hard-code Mocha values here since the
// EditorView theme is declared dark:true; for a full light-mode highlight style a
// second HighlightStyle would be needed).
const codeHighlightStyle = HighlightStyle.define([
  { tag: t.keyword,               color: '#cba6f7' }, // mauve
  { tag: t.controlKeyword,        color: '#cba6f7' },
  { tag: t.operatorKeyword,       color: '#cba6f7' },
  { tag: t.definitionKeyword,     color: '#cba6f7' },
  { tag: t.moduleKeyword,         color: '#cba6f7' },
  { tag: [t.string, t.special(t.string)], color: '#a6e3a1' }, // green
  { tag: t.number,                color: '#fab387' }, // peach
  { tag: t.bool,                  color: '#fab387' },
  { tag: t.null,                  color: '#fab387' },
  { tag: t.comment,               color: '#6c7086', fontStyle: 'italic' }, // overlay0
  { tag: t.lineComment,           color: '#6c7086', fontStyle: 'italic' },
  { tag: t.blockComment,          color: '#6c7086', fontStyle: 'italic' },
  { tag: [t.function(t.name), t.function(t.definition(t.name))], color: '#89b4fa' }, // blue
  { tag: t.definition(t.name),    color: '#89dceb' }, // sky
  { tag: t.typeName,              color: '#f9e2af' }, // yellow
  { tag: t.className,             color: '#f9e2af' },
  { tag: t.namespace,             color: '#f9e2af' },
  { tag: t.propertyName,         color: '#89dceb' }, // sky
  { tag: t.variableName,          color: '#cdd6f4' }, // text
  { tag: t.definition(t.variableName), color: '#89dceb' },
  { tag: t.operator,              color: '#89dceb' },
  { tag: t.punctuation,           color: '#9399b2' }, // overlay2
  { tag: t.angleBracket,          color: '#9399b2' },
  { tag: t.tagName,               color: '#f38ba8' }, // red
  { tag: t.attributeName,         color: '#fab387' }, // peach
  { tag: t.attributeValue,        color: '#a6e3a1' }, // green
  { tag: t.regexp,                color: '#f2cdcd' }, // flamingo
  { tag: t.escape,                color: '#f2cdcd' },
  { tag: t.link,                  color: '#89b4fa', textDecoration: 'underline' },
  { tag: t.url,                   color: '#89b4fa' },
  { tag: t.meta,                  color: '#7f849c' }, // overlay1
  { tag: t.atom,                  color: '#fab387' },
])

function createState(content: string) {
  return EditorState.create({
    doc: content,
    extensions: [
      history(),
      drawSelection(),
      dropCursor(),
      highlightActiveLine(),
      markdown({ base: markdownLanguage, codeLanguages }),
      syntaxHighlighting(codeHighlightStyle),
      markdownDecorations,
      searchHighlightField,
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      editorTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !internalUpdate) {
          emit('change', update.state.doc.toString())
        }
        if (update.docChanged && searchOpen.value) {
          const state = update.state.field(searchHighlightField)
          searchMatchCount.value = state?.matches.length ?? 0
          searchCurrentIndex.value = state?.currentIndex ?? -1
        }
      }),
    ],
  })
}

onMounted(() => {
  if (!editorEl.value) return

  view = new EditorView({
    state: createState(props.content),
    parent: editorEl.value,
  })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

// Watch filePath changes: wait for the DOM to settle (v-else re-mount),
// then reset the editor state with the already-updated content.
watch(
  () => props.filePath,
  async () => {
    await nextTick()
    if (!editorEl.value) return
    if (!view) {
      // Editor DOM was just mounted (switched from placeholder)
      view = new EditorView({
        state: createState(props.content),
        parent: editorEl.value,
      })
    } else {
      internalUpdate = true
      view.setState(createState(props.content))
      internalUpdate = false
    }
    // Re-apply search in new file if panel is open
    if (searchOpen.value && searchQuery.value) {
      applySearchQuery(searchQuery.value, 0)
    }
  }
)

// Watch content changes that come from outside (shouldn't normally fire
// after a file switch since filePath watcher handles that, but kept as
// a safety net for external mutations).
watch(
  () => props.content,
  (newContent) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (current === newContent) return
    // Only patch if the filePath hasn't just changed (filePath watcher
    // does a full setState, so avoid double-applying)
    if (!internalUpdate) {
      internalUpdate = true
      view.dispatch({
        changes: { from: 0, to: current.length, insert: newContent },
      })
      internalUpdate = false
    }
  }
)
</script>

<template>
  <div class="editor-wrap">
    <div v-if="!filePath" class="editor-placeholder">
      <p>Open a folder and select a markdown file to start editing</p>
    </div>
    <template v-else>
      <SearchPanel
        v-if="searchOpen"
        ref="searchPanelRef"
        :match-count="searchMatchCount"
        :current-index="searchCurrentIndex"
        @query="handleSearchQuery"
        @next="findNext"
        @prev="findPrev"
        @close="closeSearch"
      />
      <div ref="editorEl" class="editor-container" />
    </template>
  </div>
</template>

<style scoped>
.editor-wrap {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--editor-bg);
  position: relative;
}

.editor-container {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.editor-container :deep(.cm-editor) {
  height: 100%;
}

.editor-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 14px;
}
</style>

<style>
/* ── PlantUML diagram widget ── */
.md-plantuml-widget {
  position: relative;
  display: inline-block;
  margin: 8px 0;
  max-width: 100%;
}

.md-plantuml-widget .md-plantuml-svg {
  display: block;
  max-width: 100%;
}

.md-plantuml-widget .md-plantuml-svg svg {
  max-width: 100%;
  height: auto;
  display: block;
}

.md-plantuml-widget .md-plantuml-img {
  display: block;
  max-width: 100%;
  height: auto;
}

.md-plantuml-widget .md-plantuml-ascii {
  font-family: monospace;
  font-size: 13px;
  line-height: 1.4;
  background: var(--code-bg, #f6f8fa);
  color: var(--code-text, inherit);
  padding: 12px 16px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0;
}

.md-plantuml-widget .md-plantuml-loading {
  font-size: 13px;
  color: var(--text-muted, #888);
  padding: 8px 0;
}

.md-plantuml-widget .md-plantuml-error {
  font-size: 13px;
  color: var(--error, #c0392b);
  padding: 8px 0;
  white-space: pre-wrap;
}

.md-plantuml-edit-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: var(--toolbar-bg, rgba(0,0,0,0.06));
  color: var(--text-muted, #888);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
}

.md-plantuml-widget:hover .md-plantuml-edit-btn {
  opacity: 1;
}

.md-plantuml-edit-btn:hover {
  background: var(--toolbar-hover-bg, rgba(0,0,0,0.12));
  color: var(--text, inherit);
}
</style>
