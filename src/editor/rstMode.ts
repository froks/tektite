import { StreamLanguage, StreamParser, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

// reStructuredText is not available in @codemirror/legacy-modes and has no Lezer
// grammar, so this is a hand-rolled stream tokenizer covering the common
// constructs for syntax highlighting (not rendering): section adornments,
// directives/comments/targets, field & bullet/enumerated lists, and inline
// markup (strong, emphasis, inline literals, roles, references, substitutions).

interface RstState {
  _: never
}

const rstParser: StreamParser<RstState> = {
  name: 'rst',
  startState() {
    return {} as RstState
  },
  token(stream) {
    if (stream.sol()) {
      // Whitespace-only line
      if (stream.match(/^\s+$/)) return null
      // Section adornment / transition: a run (>=2) of one punctuation char
      if (stream.match(/^\s*([-=~`:'"^_*+#<>!$%&(){}\[\].\/\\;,?@])\1{1,}\s*$/)) return 'heading'
      // Hyperlink target: .. _name:
      if (stream.match(/^\.\.\s+_[^:]+:/)) return 'link'
      // Footnote / citation: .. [label]
      if (stream.match(/^\.\.\s+\[[^\]]+\]/)) return 'directive'
      // Substitution definition: .. |name| directive::
      if (stream.match(/^\.\.\s+\|[^|]+\|\s+[\w.+-]+::/)) return 'directive'
      // Directive: .. name::
      if (stream.match(/^\.\.\s+[\w.+-]+::/)) return 'directive'
      // Comment: .. rest-of-line (or a lone ..)
      if (stream.match(/^\.\.(\s.*)?$/)) return 'comment'
      // Field list: :name:
      if (stream.match(/^\s*:[^:\n]+:(\s|$)/)) return 'field'
      // Bullet list marker
      if (stream.match(/^\s*[-*+]\s+/)) return 'list'
      // Enumerated list marker
      if (stream.match(/^\s*(\d+|#|[a-zA-Z])[.)]\s+/)) return 'list'
      // Doctest block
      if (stream.match(/^\s*>>> /)) return 'literal'
      // otherwise fall through to inline scanning
    }

    // Inline constructs
    if (stream.match(/^``[^`]+``/)) return 'literal'
    if (stream.match(/^\*\*(?:[^*]|\*(?!\*))+\*\*/)) return 'strong'
    if (stream.match(/^\*[^*\s](?:[^*]*[^*\s])?\*/)) return 'emphasis'
    if (stream.match(/^:[\w.+-]+:`[^`]*`/)) return 'role'
    if (stream.match(/^`[^`]+`__?/)) return 'link'
    if (stream.match(/^`[^`]+`/)) return 'role'
    if (stream.match(/^\|[^|\s][^|]*\|/)) return 'substitution'
    if (stream.match(/^[A-Za-z0-9]+__?\b/)) return 'link'
    if (stream.match(/^https?:\/\/\S+/)) return 'link'

    // Plain text: consume until the next character that could start a construct
    if (stream.match(/^[^*`:|\s]+/)) return null
    stream.next()
    return null
  },
  tokenTable: {
    heading: t.heading,
    directive: t.keyword,
    comment: t.comment,
    literal: t.string,
    strong: t.strong,
    emphasis: t.emphasis,
    role: t.meta,
    link: t.link,
    substitution: t.atom,
    field: t.propertyName,
    list: t.keyword,
  },
}

// Catppuccin Mocha colours, matching the dark code-highlight style used elsewhere.
const rstHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: '#89b4fa', fontWeight: '700' },
  { tag: t.keyword, color: '#cba6f7' },
  { tag: t.comment, color: '#6c7086', fontStyle: 'italic' },
  { tag: t.string, color: '#a6e3a1' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.meta, color: '#94e2d5' },
  { tag: t.link, color: '#89b4fa', textDecoration: 'underline' },
  { tag: t.atom, color: '#fab387' },
  { tag: t.propertyName, color: '#89dceb' },
])

export const rstSupport: Extension = [
  StreamLanguage.define(rstParser),
  syntaxHighlighting(rstHighlightStyle),
]
