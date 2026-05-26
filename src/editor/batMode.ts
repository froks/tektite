import { StreamParser } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// Windows batch (.bat/.cmd) has no @codemirror/legacy-modes entry, so this is a
// small hand-rolled stream tokenizer for syntax highlighting: REM/:: comments,
// :labels, %VAR%/!VAR!/%1 expansions, quoted strings, numbers, and common
// command keywords.

interface BatState {
  atLineStart: boolean
}

const batKeywords =
  /^(?:rem|echo|set|setlocal|endlocal|if|else|for|in|do|goto|call|exit|shift|pause|cls|cd|chdir|md|mkdir|rd|rmdir|del|erase|copy|xcopy|move|ren|rename|type|find|findstr|pushd|popd|start|title|color|prompt|path|ver|date|time|choice|errorlevel|not|exist|defined|equ|neq|lss|leq|gtr|geq|enabledelayedexpansion|enableextensions|disabledelayedexpansion)(?=\s|$|\()/i

export const batParser: StreamParser<BatState> = {
  name: 'bat',
  startState() {
    return { atLineStart: true }
  },
  token(stream, state) {
    if (stream.sol()) state.atLineStart = true
    if (stream.eatSpace()) return null

    const atStart = state.atLineStart
    state.atLineStart = false

    if (atStart) {
      if (stream.match(/^@/)) return 'operator'
      if (stream.match(/^rem(?=\s|$)/i)) { stream.skipToEnd(); return 'comment' }
      if (stream.match(/^::/)) { stream.skipToEnd(); return 'comment' }
      if (stream.match(/^:[A-Za-z0-9_.-]+/)) { stream.skipToEnd(); return 'label' }
    }

    // Variable expansions: %VAR%, %1, %~dp0, !VAR!
    if (stream.match(/^%[^%\s]+%/)) return 'variable'
    if (stream.match(/^%[*0-9~][^\s%]*/)) return 'variable'
    if (stream.match(/^![^!\s]+!/)) return 'variable'

    if (stream.match(/^"[^"]*"/)) return 'string'
    if (stream.match(/^\d+\b/)) return 'number'
    if (stream.match(batKeywords)) return 'keyword'
    if (stream.match(/^(?:==|>=|<=|&&|\|\||[=<>|&()@])/)) return 'operator'

    if (stream.match(/^[A-Za-z0-9_.\\/:-]+/)) return null
    stream.next()
    return null
  },
  tokenTable: {
    comment: t.comment,
    keyword: t.keyword,
    variable: t.atom,
    string: t.string,
    label: t.tagName,
    number: t.number,
    operator: t.operator,
  },
}
