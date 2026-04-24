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
 *
 * IMPORTANT: Block decorations (block:true) must come from a StateField, not a
 * ViewPlugin — CM6 enforces this with a RangeError at runtime. The async link
 * existence check is the only thing that stays in a ViewPlugin.
 */

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { EditorState, Range, StateEffect, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { invoke } from '@tauri-apps/api/core'
import { resolveLink, resolveWikiLink, isInternalLink } from './linkResolver'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cursorLineNumbers(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number
    const toLine = state.doc.lineAt(range.to).number
    for (let l = fromLine; l <= toLine; l++) lines.add(l)
  }
  return lines
}

/** Returns the set of all line numbers that belong to code blocks touching a cursor line. */
function activeCodeBlockLineNumbers(state: EditorState, cursorLines: Set<number>): Set<number> {
  const result = new Set<number>()
  const doc = state.doc
  syntaxTree(state).iterate({
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
const blockquoteLines = [1, 2, 3, 4].map(n =>
  Decoration.line({ class: `md-blockquote-line md-blockquote-depth-${n}` })
)
const quoteMarkMark = Decoration.mark({ class: 'md-blockquote-mark' })
const codeBlockLine = Decoration.line({ class: 'md-codeblock-line' })
const codeFenceLine = Decoration.line({ class: 'md-codefence-line' })

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

// ─── Table widget ─────────────────────────────────────────────────────────────

type CellAlign = 'left' | 'center' | 'right' | ''

function parseAlignments(sepText: string): CellAlign[] {
  return sepText
    .split('|')
    .slice(1, -1)
    .map(cell => {
      const c = cell.trim()
      if (c.startsWith(':') && c.endsWith(':')) return 'center'
      if (c.endsWith(':')) return 'right'
      if (c.startsWith(':')) return 'left'
      return ''
    })
}

// Unescape markdown escape sequences (e.g. \| → |, \* → *)
function mdUnescape(text: string): string {
  return text.replace(/\\(.)/g, '$1')
}

class TableWidget extends WidgetType {
  constructor(
    private readonly key: string,
    private readonly headers: string[],
    private readonly alignments: CellAlign[],
    private readonly rows: string[][],
  ) { super() }

  eq(other: TableWidget) { return other.key === this.key }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'md-table-widget'
    const table = document.createElement('table')
    wrap.appendChild(table)

    const thead = document.createElement('thead')
    table.appendChild(thead)
    const headerTr = document.createElement('tr')
    thead.appendChild(headerTr)
    for (let i = 0; i < this.headers.length; i++) {
      const th = document.createElement('th')
      th.textContent = mdUnescape(this.headers[i])
      const align = this.alignments[i]
      if (align) th.style.textAlign = align
      headerTr.appendChild(th)
    }

    const tbody = document.createElement('tbody')
    table.appendChild(tbody)
    for (const row of this.rows) {
      const tr = document.createElement('tr')
      tbody.appendChild(tr)
      for (let i = 0; i < this.headers.length; i++) {
        const td = document.createElement('td')
        td.textContent = mdUnescape(row[i] ?? '')
        const align = this.alignments[i]
        if (align) td.style.textAlign = align
        tr.appendChild(td)
      }
    }

    return wrap
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
  state: EditorState,
  currentFilePath: string,
  rootPath: string,
): string[] {
  const paths: string[] = []
  const doc = state.doc
  const src = doc.toString()

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'Link') {
        const isWiki = node.from > 0 && src[node.from - 1] === '[' &&
          node.to < src.length && src[node.to] === ']'

        let urlText = ''
        node.node.getChildren('URL').forEach(u => { urlText = src.slice(u.from, u.to) })

        if (isWiki) {
          const inner = src.slice(node.from + 1, node.to - 1)
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
  state: EditorState,
  existenceCache: Map<string, boolean>,
  currentFilePath: string,
  rootPath: string,
  onNavigate: (path: string) => void,
): DecorationSet {
  try {
    const decs: Range<Decoration>[] = []
    const doc = state.doc
    const src = doc.toString()
    const cursorLines = cursorLineNumbers(state)
    const activeBlockLines = activeCodeBlockLineNumbers(state, cursorLines)

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

    // ── Pre-pass: compute blockquote nesting depth per line ──────────────────
    const blockquoteDepth = new Map<number, number>()
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name !== 'Blockquote') return
        const startLine = doc.lineAt(node.from).number
        const endLine = doc.lineAt(node.to).number
        for (let n = startLine; n <= endLine; n++) {
          blockquoteDepth.set(n, (blockquoteDepth.get(n) ?? 0) + 1)
        }
      },
    })

    // ── Walk the syntax tree ─────────────────────────────────────────────────
    syntaxTree(state).iterate({
      enter(node) {
        const { name, from, to } = node

        // ── Fenced / indented code blocks ──────────────────────────────────
        if (name === 'FencedCode') {
          const openFenceLine = doc.lineAt(from)
          const closeFenceLine = doc.lineAt(to)
          const active = isActiveBlock(from)

          decs.push(codeFenceLine.range(openFenceLine.from))
          const codeTextNode = node.node.getChild('CodeText')
          const codeText = codeTextNode ? src.slice(codeTextNode.from, codeTextNode.to) : ''
          pushWidget(new CopyButtonWidget(codeText), openFenceLine.to)

          if (closeFenceLine.number !== openFenceLine.number) {
            for (let n = openFenceLine.number + 1; n <= closeFenceLine.number; n++) {
              decs.push(codeBlockLine.range(doc.line(n).from))
            }
          }

          if (!active) {
            pushMark(hideMark, openFenceLine.from, openFenceLine.to)
            if (closeFenceLine.number !== openFenceLine.number) {
              pushMark(hideMark, closeFenceLine.from, closeFenceLine.to)
            }
          }
          return // don't recurse into code block children via our decorator
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
          return
        }

        // ── HeaderMark (the # characters) ─────────────────────────────────
        if (name === 'HeaderMark') {
          if (!isActiveLine(from)) {
            pushMark(hideMark, from, to + 1)
          }
          return false
        }

        // ── Blockquote ─────────────────────────────────────────────────────
        if (name === 'Blockquote') {
          if (node.node.parent?.name === 'Blockquote') return
          const startLine = doc.lineAt(from).number
          const endLine = doc.lineAt(to).number
          for (let n = startLine; n <= endLine; n++) {
            if (!cursorLines.has(n)) {
              const depth = Math.min(blockquoteDepth.get(n) ?? 1, 4)
              decs.push(blockquoteLines[depth - 1].range(doc.line(n).from))
            }
          }
          return
        }

        if (name === 'QuoteMark') {
          pushMark(quoteMarkMark, from, to + (src[to] === ' ' ? 1 : 0))
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
            decs.push(dec.range(from, to))
            node.node.cursor().iterate(child => {
              if (child.name === 'EmphasisMark' || child.name === 'StrikethroughMark') {
                decs.push(hideMark.range(child.from, child.to))
              }
            })
          } else {
            decs.push(dec.range(from, to))
          }
          return false
        }

        // ── Inline code ────────────────────────────────────────────────────
        if (name === 'InlineCode') {
          decs.push(codeMark.range(from, to))
          if (!isActiveLine(from)) {
            const marks = node.node.getChildren('CodeMark')
            marks.forEach(m => decs.push(hideMark.range(m.from, m.to)))
          }
          return false
        }

        // ── Links (including wiki-links) ───────────────────────────────────
        if (name === 'Link') {
          const isWiki = from > 0 && src[from - 1] === '[' &&
            to < src.length && src[to] === ']'

          const urlNode = node.node.getChild('URL')
          const urlText = urlNode ? src.slice(urlNode.from, urlNode.to) : ''

          if (isWiki) {
            const wikiFrom = from - 1
            const wikiTo = to + 1
            const inner = src.slice(from + 1, to - 1)
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

          if (!isActiveLine(from)) {
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
            const linkMarks = node.node.getChildren('LinkMark')
            const labelStart = linkMarks[0] ? linkMarks[0].to : from + 2
            const labelEnd = linkMarks[1] ? linkMarks[1].from : to
            pushMark(linkTextMark, labelStart, labelEnd)
          }
          return false
        }

        // ── Tables ─────────────────────────────────────────────────────────
        if (name === 'Table') {
          const tableStartLine = doc.lineAt(from).number
          const tableEndLine = doc.lineAt(to).number
          let activeInTable = false
          for (let n = tableStartLine; n <= tableEndLine; n++) {
            if (cursorLines.has(n)) { activeInTable = true; break }
          }
          if (activeInTable) return false

          const tableNode = node.node

          const headers: string[] = []
          for (const child of tableNode.getChildren('TableHeader')) {
            for (const td of child.getChildren('TableCell')) {
              headers.push(src.slice(td.from, td.to).trim())
            }
          }

          let alignments: CellAlign[] = headers.map(() => '')
          for (const d of tableNode.getChildren('TableDelimiter')) {
            const sepText = src.slice(d.from, d.to)
            if (/^[\s|:\-]+$/.test(sepText)) {
              alignments = parseAlignments(sepText)
              break
            }
          }

          const rows: string[][] = []
          for (const row of tableNode.getChildren('TableRow')) {
            const rowLine = doc.lineAt(row.from)
            if (/^[\s|:\-]+$/.test(src.slice(rowLine.from, rowLine.to))) continue
            const cells: string[] = []
            for (const td of row.getChildren('TableCell')) {
              cells.push(src.slice(td.from, td.to).trim())
            }
            rows.push(cells)
          }

          // Align range exactly to line boundaries (required for block:true).
          const lineFrom = doc.lineAt(from).from
          const lineTo = doc.lineAt(to).to

          decs.push(
            Decoration.replace({
              widget: new TableWidget(src.slice(from, to), headers, alignments, rows),
              block: true,
            }).range(lineFrom, lineTo),
          )
          return false
        }
      },
    })

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
  // StateEffect / StateField for the async link existence cache.
  // Kept separate from the decoration StateField so a cache update can trigger
  // a decoration rebuild without a full doc change.
  const updateExistenceCache = StateEffect.define<Map<string, boolean>>()

  const existenceCacheField = StateField.define<Map<string, boolean>>({
    create: () => new Map(),
    update(cache, tr) {
      for (const effect of tr.effects) {
        if (effect.is(updateExistenceCache)) return effect.value
      }
      return cache
    },
  })

  // StateField for all decorations (including block widgets).
  // CM6 requires block:true decorations to come from a StateField, not a ViewPlugin.
  const decorationsField = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(
        state,
        state.field(existenceCacheField),
        options.currentFilePath(),
        options.rootPath(),
        options.onNavigate,
      )
    },
    update(deco, tr) {
      if (
        tr.docChanged ||
        tr.selection ||
        tr.effects.some(e => e.is(updateExistenceCache))
      ) {
        return buildDecorations(
          tr.state,
          tr.state.field(existenceCacheField),
          options.currentFilePath(),
          options.rootPath(),
          options.onNavigate,
        )
      }
      return deco.map(tr.changes)
    },
    provide: f => EditorView.decorations.from(f),
  })

  // ViewPlugin for async link existence checks only — no decorations here.
  const linkCheckerPlugin = ViewPlugin.fromClass(
    class {
      private pendingCheck = false

      constructor(view: EditorView) {
        this.scheduleExistenceCheck(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.scheduleExistenceCheck(update.view)
        }
      }

      scheduleExistenceCheck(view: EditorView) {
        if (this.pendingCheck) return
        this.pendingCheck = true
        const filePath = options.currentFilePath()
        const rPath = options.rootPath()
        if (!filePath) { this.pendingCheck = false; return }

        const paths = collectInternalLinkPaths(view.state, filePath, rPath)
        if (paths.length === 0) { this.pendingCheck = false; return }

        const unique = [...new Set(paths)]
        Promise.all(
          unique.map(async p => ({ p, exists: await invoke<boolean>('file_exists', { path: p }) }))
        ).then(results => {
          const currentCache = view.state.field(existenceCacheField)
          const newCache = new Map(currentCache)
          let changed = false
          for (const { p, exists } of results) {
            if (newCache.get(p) !== exists) {
              newCache.set(p, exists)
              changed = true
            }
          }
          this.pendingCheck = false
          if (changed) view.dispatch({ effects: updateExistenceCache.of(newCache) })
        }).catch(() => { this.pendingCheck = false })
      }
    },
  )

  return [existenceCacheField, decorationsField, linkCheckerPlugin]
}
