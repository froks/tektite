<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { EditorView, keymap, drawSelection, highlightActiveLine, dropCursor } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { createMarkdownDecorations } from '../editor/markdownDecorations'

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
let view: EditorView | null = null
let internalUpdate = false

const markdownDecorations = createMarkdownDecorations({
  currentFilePath: () => props.filePath ?? '',
  rootPath: () => props.rootPath,
  onNavigate: (path) => emit('navigate', path),
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
    background: 'var(--code-block-bg)',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: '0.9em',
    display: 'block',
  },
  '.md-codefence-anchor': {
    position: 'relative',
  },
  '.md-codefence-line': {
    background: 'var(--code-block-bg)',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: '0.9em',
    display: 'block',
    position: 'relative',
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
    borderLeft: '3px solid var(--accent)',
    paddingLeft: '12px',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  '.md-blockquote-mark': {
    opacity: '0.35',
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
  // Table styles
  '.md-table-header': {
    fontWeight: '700',
    borderBottom: '2px solid var(--border)',
    color: 'var(--text)',
  },
  '.md-table-row': {
    borderBottom: '1px solid var(--border)',
  },
  '.md-table-sep': {
    fontSize: '0',
    height: '0',
    padding: '0',
    overflow: 'hidden',
    lineHeight: '0',
    borderBottom: '2px solid var(--border)',
  },
  '.md-table-delim': {
    color: 'var(--border)',
    opacity: '0.5',
  },
  '.md-table-cell': {
    paddingRight: '12px',
  },
}, { dark: true })

function createState(content: string) {
  return EditorState.create({
    doc: content,
    extensions: [
      history(),
      drawSelection(),
      dropCursor(),
      highlightActiveLine(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      markdownDecorations,
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      editorTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !internalUpdate) {
          emit('change', update.state.doc.toString())
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
      return
    }
    internalUpdate = true
    view.setState(createState(props.content))
    internalUpdate = false
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
    <div v-else ref="editorEl" class="editor-container" />
  </div>
</template>

<style scoped>
.editor-wrap {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--editor-bg);
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
