/**
 * Obsidian-style markdown decorations for CodeMirror 6.
 *
 * Decoration logic is driven by walking the Lezer syntax tree produced by
 * @codemirror/lang-markdown (markdownLanguage), which includes GFM extensions
 * (strikethrough, task lists, tables, etc.).
 *
 * Rules:
 * - Lines NOT containing the cursor: syntax markers hidden, formatting rendered.
 * - Lines containing the cursor: raw markdown shown with light styling on content.
 * - Heading font sizes always applied (even on the active line) for consistency.
 * - Fenced code blocks: revealed entirely when the cursor is anywhere inside.
 */

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { invoke } from '@tauri-apps/api/core'
import { resolveLink, resolveWikiLink, isInternalLink } from './linkResolver'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cursorLineNumbers(view: EditorView): Set<number> {
  const lines = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const fromLine = view.state.doc.lineAt(range.from).number
    const toLine = view.state.doc.lineAt(range.to).number
    for (let l = fromLine; l <= toLine; l++) lines.add(l)
  }
  return lines
}

/** Returns the set of all line numbers that belong to code blocks touching a cursor line. */
function activeCodeBlockLineNumbers(view: EditorView, cursorLines: Set<number>): Set<number> {
  const result = new Set<number>()
  const doc = view.state.doc
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return
      const startLine = doc.lineAt(node.from).number
      const endLine = doc.lineAt(node.to).number
      let touched = false
      for (let n = startLine; n <= endLine; n++) {
        if (cursorLines.has(n)) { touched = true; break }
      }
      if (touched) {
        for (let n = startLine; n <= endLine; n++) result.add(n)
      }
    },
  })
  return result
}

// ─── Static mark decorations ─────────────────────────────────────────────────

const hideMark = Decoration.mark({ class: 'md-hide' })
const boldMark = Decoration.mark({ class: 'md-bold' })
const italicMark = Decoration.mark({ class: 'md-italic' })
const strikeMark = Decoration.mark({ class: 'md-strike' })
const codeMark = Decoration.mark({ class: 'md-code-inline' })
const linkTextMark = Decoration.mark({ class: 'md-link-text' })
const linkUrlMark = Decoration.mark({ class: 'md-link-url' })

const headingLineClass = [1, 2, 3, 4, 5, 6].map(n =>
  Decoration.line({ class: `md-h${n}` })
)
const blockquoteLine = Decoration.line({ class: 'md-blockquote-line' })
const codeBlockLine = Decoration.line({ class: 'md-codeblock-line' })
const codeFenceLine = Decoration.line({ class: 'md-codefence-line' })
const codeFenceAnchor = Decoration.line({ class: 'md-codefence-anchor' })
const tableHeaderLine = Decoration.line({ class: 'md-table-header' })
const tableRowLine = Decoration.line({ class: 'md-table-row' })
const tableSepLine = Decoration.line({ class: 'md-table-sep' })
const tableDelimMark = Decoration.mark({ class: 'md-table-delim' })
const tableCellMark = Decoration.mark({ class: 'md-table-cell' })

// ─── Copy button ──────────────────────────────────────────────────────────────

class CopyButtonWidget extends WidgetType {
  constructor(private code: string) { super() }
  eq(other: CopyButtonWidget) { return other.code === this.code }

  toDOM() {
    const btn = document.createElement('button')
    btn.className = 'md-copy-btn'
    btn.title = 'Copy code'
    const copyIcon = `<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
      <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
      <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
    </svg>`
    const checkIcon = `<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
    </svg>`
    btn.innerHTML = copyIcon
    btn.addEventListener('mousedown', e => {
      e.preventDefault()
      navigator.clipboard.writeText(this.code).then(() => {
        btn.innerHTML = checkIcon
        setTimeout(() => { btn.innerHTML = copyIcon }, 2000)
      })
    })
    return btn
  }
  ignoreEvent() { return false }
}

// ─── HR widget ────────────────────────────────────────────────────────────────

class HrWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span')
    el.className = 'md-hr-widget'
    return el
  }
  ignoreEvent() { return false }
}

// ─── Checkbox widget ──────────────────────────────────────────────────────────

class CheckboxWidget extends WidgetType {
  constructor(private checked: boolean, private markerFrom: number) { super() }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.markerFrom === this.markerFrom
  }
  toDOM(view: EditorView) {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = this.checked
    cb.className = 'md-checkbox'
    cb.addEventListener('mousedown', e => {
      e.preventDefault()
      const newChar = this.checked ? ' ' : 'x'
      view.dispatch({ changes: { from: this.markerFrom + 1, to: this.markerFrom + 2, insert: newChar } })
    })
    return cb
  }
  ignoreEvent() { return false }
}

// ─── Link widget ──────────────────────────────────────────────────────────────

class LinkWidget extends WidgetType {
  constructor(
    private label: string,
    private resolvedPath: string | null,
    private broken: boolean,
    private onNavigate: (path: string) => void,
  ) { super() }

  eq(other: LinkWidget) {
    return other.label === this.label &&
      other.resolvedPath === this.resolvedPath &&
      other.broken === this.broken
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'md-link-widget' + (this.broken ? ' md-link-widget--broken' : '')
    span.textContent = this.label
    if (this.resolvedPath) span.title = this.resolvedPath
    if (this.resolvedPath && !this.broken) {
      span.addEventListener('mousedown', e => {
        e.preventDefault()
        this.onNavigate(this.resolvedPath!)
      })
    }
    return span
  }
  ignoreEvent() { return false }
}

// ─── Link scanning for existence checks ──────────────────────────────────────

function collectInternalLinkPaths(
  view: EditorView,
  currentFilePath: string,
  rootPath: string,
): string[] {
  const paths: string[] = []
  const doc = view.state.doc
  const src = doc.toString()

  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name === 'Link') {
        // Check for wiki-link: char before node.from is '[' and char after node.to is ']'
        const isWiki = node.from > 0 && src[node.from - 1] === '[' &&
          node.to < src.length && src[node.to] === ']'

        // Get URL child
        let urlText = ''
        node.node.getChildren('URL').forEach(u => { urlText = src.slice(u.from, u.to) })

        if (isWiki) {
          // Wiki-link: inner text is the target (may have |display)
          const inner = src.slice(node.from + 1, node.to - 1) // strip [ ]
          const target = inner.split('|')[0]
          paths.push(resolveWikiLink(target, currentFilePath, rootPath))
        } else if (urlText && isInternalLink(urlText)) {
          const resolved = resolveLink(urlText, currentFilePath)
          if (resolved) paths.push(resolved)
        }
      }
    },
  })
  return paths
}

// ─── Main decoration builder ──────────────────────────────────────────────────

function buildDecorations(
  view: EditorView,
  existenceCache: Map<string, boolean>,
  currentFilePath: string,
  rootPath: string,
  onNavigate: (path: string) => void,
): DecorationSet {
  try {
    const decs: Range<Decoration>[] = []
    const doc = view.state.doc
    const src = doc.toString()
    const cursorLines = cursorLineNumbers(view)
    const activeBlockLines = activeCodeBlockLineNumbers(view, cursorLines)

    // Track which character positions have already been decorated (marks only,
    // widgets are point decorations and don't occupy ranges).
    // We use a simple sorted list of [from,to] pairs and check before inserting.
    const markedRanges: Array<[number, number]> = []

    function overlaps(from: number, to: number): boolean {
      for (const [a, b] of markedRanges) {
        if (from < b && to > a) return true
      }
      return false
    }

    function pushMark(dec: Decoration, from: number, to: number) {
      if (from >= to || overlaps(from, to)) return
      markedRanges.push([from, to])
      decs.push(dec.range(from, to))
    }

    function pushWidget(widget: WidgetType, at: number, side: -1 | 1 = 1) {
      decs.push(Decoration.widget({ widget, side }).range(at))
    }

    function isActiveLine(pos: number): boolean {
      return cursorLines.has(doc.lineAt(pos).number)
    }

    function isActiveBlock(pos: number): boolean {
      return activeBlockLines.has(doc.lineAt(pos).number)
    }

    // ── Walk the syntax tree ─────────────────────────────────────────────────
    syntaxTree(view.state).iterate({
      enter(node) {
        const { name, from, to } = node

        // ── Fenced / indented code blocks ──────────────────────────────────
        if (name === 'FencedCode') {
          const openFenceLine = doc.lineAt(from)
          const closeFenceLine = doc.lineAt(to)
          const active = isActiveBlock(from)

          // Always put the copy button anchor + button on the opening fence line
          decs.push(codeFenceAnchor.range(openFenceLine.from))
          const codeTextNode = node.node.getChild('CodeText')
          const codeText = codeTextNode ? src.slice(codeTextNode.from, codeTextNode.to) : ''
          pushWidget(new CopyButtonWidget(codeText), openFenceLine.to)

          if (!active) {
            // Hide both fence lines, style body lines with bg
            pushMark(hideMark, openFenceLine.from, openFenceLine.to)
            decs.push(codeFenceLine.range(openFenceLine.from))

            if (closeFenceLine.number !== openFenceLine.number) {
              pushMark(hideMark, closeFenceLine.from, closeFenceLine.to)

              for (let n = openFenceLine.number + 1; n < closeFenceLine.number; n++) {
                decs.push(codeBlockLine.range(doc.line(n).from))
              }
            }
          }
          return false // don't recurse into code block children
        }

        // ── Horizontal rules ───────────────────────────────────────────────
        if (name === 'HorizontalRule') {
          if (!isActiveLine(from)) {
            pushMark(hideMark, from, to)
            pushWidget(new HrWidget(), from, -1)
          }
          return false
        }

        // ── Headings ───────────────────────────────────────────────────────
        const headingMatch = name.match(/^ATXHeading(\d)$/)
        if (headingMatch) {
          const level = parseInt(headingMatch[1]) - 1
          const line = doc.lineAt(from)
          decs.push(headingLineClass[level].range(line.from))
          // HeaderMark children are handled below — skip returning false so
          // we recurse to pick up HeaderMark and inline nodes
          return
        }

        // ── HeaderMark (the # characters) ─────────────────────────────────
        if (name === 'HeaderMark') {
          if (!isActiveLine(from)) {
            // Hide the mark plus the space after it
            pushMark(hideMark, from, to + 1)
          }
          return false
        }

        // ── Blockquote ─────────────────────────────────────────────────────
        if (name === 'Blockquote') {
          decs.push(blockquoteLine.range(doc.lineAt(from).from))
          return
        }

        if (name === 'QuoteMark') {
          pushMark(hideMark, from, to + (src[to] === ' ' ? 1 : 0))
          return false
        }

        // ── Task list items ────────────────────────────────────────────────
        if (name === 'TaskMarker') {
          if (!isActiveLine(from)) {
            const checked = src[from + 1].toLowerCase() === 'x'
            pushMark(hideMark, from, to)
            pushWidget(new CheckboxWidget(checked, from), from, -1)
          }
          return false
        }

        // ── Inline emphasis ────────────────────────────────────────────────
        if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'Strikethrough') {
          const dec = name === 'StrongEmphasis' ? boldMark
            : name === 'Strikethrough' ? strikeMark
            : italicMark

          if (!isActiveLine(from)) {
            // Hide all EmphasisMark / StrikethroughMark children, style content
            node.node.cursor().iterate(child => {
              if (child.name === 'EmphasisMark' || child.name === 'StrikethroughMark') {
                pushMark(hideMark, child.from, child.to)
              }
            })
            // Style the whole node as bold/italic/strike — marks hide the syntax
            pushMark(dec, from, to)
          } else {
            // Active line: style but leave markers visible
            pushMark(dec, from, to)
          }
          return false
        }

        // ── Inline code ────────────────────────────────────────────────────
        if (name === 'InlineCode') {
          if (!isActiveLine(from)) {
            const marks = node.node.getChildren('CodeMark')
            marks.forEach(m => pushMark(hideMark, m.from, m.to))
          }
          pushMark(codeMark, from, to)
          return false
        }

        // ── Links (including wiki-links) ───────────────────────────────────
        if (name === 'Link') {
          // Detect wiki-link: preceded by '[' and followed by ']'
          const isWiki = from > 0 && src[from - 1] === '[' &&
            to < src.length && src[to] === ']'

          const urlNode = node.node.getChild('URL')
          const urlText = urlNode ? src.slice(urlNode.from, urlNode.to) : ''

          if (isWiki) {
            // The outer [[ and ]] are plain text — cover them too
            const wikiFrom = from - 1
            const wikiTo = to + 1
            const inner = src.slice(from + 1, to - 1)  // strip inner [ ]
            const pipeIdx = inner.indexOf('|')
            const target = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner
            const label = pipeIdx >= 0 ? inner.slice(pipeIdx + 1) : target.replace(/\.md$/, '')

            const resolvedPath = resolveWikiLink(target, currentFilePath, rootPath)
            const broken = existenceCache.get(resolvedPath) === false

            if (!isActiveLine(from)) {
              pushMark(hideMark, wikiFrom, wikiTo)
              pushWidget(new LinkWidget(label, resolvedPath, broken, onNavigate), wikiTo)
            } else {
              pushMark(linkTextMark, from + 1, to - 1)
            }
            return false
          }

          // Standard link
          if (!isActiveLine(from)) {
            // Get the label text (between first LinkMark [ and ])
            const linkMarks = node.node.getChildren('LinkMark')
            const labelStart = linkMarks[0] ? linkMarks[0].to : from + 1
            const labelEnd = linkMarks[1] ? linkMarks[1].from : (urlNode ? urlNode.from - 2 : to)
            const label = src.slice(labelStart, labelEnd)

            const internal = isInternalLink(urlText)
            const resolvedPath = internal ? resolveLink(urlText, currentFilePath) : null
            const broken = internal && resolvedPath !== null
              ? existenceCache.get(resolvedPath) === false
              : false

            pushMark(hideMark, from, to)
            pushWidget(
              new LinkWidget(label || urlText, resolvedPath, broken, onNavigate),
              to,
            )
          } else {
            // Active: style label and URL in place
            const linkMarks = node.node.getChildren('LinkMark')
            const labelStart = linkMarks[0] ? linkMarks[0].to : from + 1
            const labelEnd = linkMarks[1] ? linkMarks[1].from : to
            pushMark(linkTextMark, labelStart, labelEnd)
            if (urlNode) pushMark(linkUrlMark, urlNode.from, urlNode.to)
          }
          return false
        }

        // ── Image — leave as-is (just style alt text) ─────────────────────
        if (name === 'Image') {
          if (!isActiveLine(from)) {
            // Show as plain styled text with the alt text
            const linkMarks = node.node.getChildren('LinkMark')
            const labelStart = linkMarks[0] ? linkMarks[0].to : from + 2
            const labelEnd = linkMarks[1] ? linkMarks[1].from : to
            pushMark(linkTextMark, labelStart, labelEnd)
          }
          return false
        }

        // ── Tables ─────────────────────────────────────────────────────────
        if (name === 'Table') {
          // Walk table children manually so we can classify each row
          const tableNode = node.node
          for (const child of tableNode.getChildren('TableHeader')) {
            const line = doc.lineAt(child.from)
            decs.push(tableHeaderLine.range(line.from))
            for (const td of child.getChildren('TableCell')) {
              pushMark(tableCellMark, td.from, td.to)
            }
            for (const td of child.getChildren('TableDelimiter')) {
              pushMark(tableDelimMark, td.from, td.to)
            }
          }
          // Delimiter/separator row (the |---|---| line) — it's a direct child
          // named TableDelimiter at the Table level in some parser versions,
          // but in @lezer/markdown GFM it comes out as a row of TableDelimiters
          // inside the Table (between header and rows). Detect it by checking
          // if the line only contains dashes, pipes and spaces.
          const allRows = tableNode.getChildren('TableRow')
          for (const row of allRows) {
            const rowLine = doc.lineAt(row.from)
            const lineText = src.slice(rowLine.from, rowLine.to)
            const isSep = /^[\s|:\-]+$/.test(lineText)
            if (isSep) {
              decs.push(tableSepLine.range(rowLine.from))
            } else {
              decs.push(tableRowLine.range(rowLine.from))
              for (const td of row.getChildren('TableCell')) {
                pushMark(tableCellMark, td.from, td.to)
              }
              for (const td of row.getChildren('TableDelimiter')) {
                pushMark(tableDelimMark, td.from, td.to)
              }
            }
          }
          // Handle the separator row that sits between TableHeader and TableRow
          // as direct TableDelimiter children of Table (lezer GFM layout)
          const directDelims = tableNode.getChildren('TableDelimiter')
          for (const d of directDelims) {
            const line = doc.lineAt(d.from)
            const lineText = src.slice(line.from, line.to)
            if (/^[\s|:\-]+$/.test(lineText)) {
              decs.push(tableSepLine.range(line.from))
            }
          }
          return false
        }
      },
    })

    // Sort by from, then by startSide (CodeMirror internal field).
    // startSide: marks = -1, line = -1, widget(side:-1) = -1, widget(side:1) = 1
    // At same `from`, lower startSide must come first.
    decs.sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from
      const sideA = (a.value as unknown as { startSide: number }).startSide ?? 0
      const sideB = (b.value as unknown as { startSide: number }).startSide ?? 0
      return sideA - sideB
    })

    return Decoration.set(decs, true)
  } catch (e) {
    console.error('buildDecorations error:', e)
    return Decoration.none
  }
}

// ─── View Plugin factory ──────────────────────────────────────────────────────

export interface MarkdownDecorationsOptions {
  currentFilePath: () => string
  rootPath: () => string
  onNavigate: (path: string) => void
}

export function createMarkdownDecorations(options: MarkdownDecorationsOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      existenceCache = new Map<string, boolean>()
      private pendingCheck = false

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, this.existenceCache, options.currentFilePath(), options.rootPath(), options.onNavigate)
        this.scheduleExistenceCheck(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, this.existenceCache, options.currentFilePath(), options.rootPath(), options.onNavigate)
          if (update.docChanged) {
            this.scheduleExistenceCheck(update.view)
          }
        }
      }

      scheduleExistenceCheck(view: EditorView) {
        if (this.pendingCheck) return
        this.pendingCheck = true
        const filePath = options.currentFilePath()
        const rPath = options.rootPath()
        if (!filePath) { this.pendingCheck = false; return }

        const paths = collectInternalLinkPaths(view, filePath, rPath)
        if (paths.length === 0) { this.pendingCheck = false; return }

        const unique = [...new Set(paths)]
        Promise.all(
          unique.map(async p => ({ p, exists: await invoke<boolean>('file_exists', { path: p }) }))
        ).then(results => {
          let changed = false
          for (const { p, exists } of results) {
            if (this.existenceCache.get(p) !== exists) {
              this.existenceCache.set(p, exists)
              changed = true
            }
          }
          this.pendingCheck = false
          if (changed) view.dispatch({})
        }).catch(() => { this.pendingCheck = false })
      }
    },
    { decorations: v => v.decorations }
  )
}
