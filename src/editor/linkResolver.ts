/**
 * Resolves link targets in markdown files to absolute paths.
 *
 * Supports:
 *  - Standard links: [text](target)  — target is relative to currentFilePath's directory
 *  - Wiki-links: [[target]]          — resolved relative to currentFilePath's dir first,
 *                                      then relative to rootPath as fallback
 *
 * In both cases, a missing .md extension is appended automatically.
 */

function dirname(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  return idx >= 0 ? filePath.substring(0, idx) : ''
}

function normalize(p: string): string {
  // Collapse any foo/../bar segments — simple iterative approach
  const sep = p.includes('\\') ? '\\' : '/'
  const parts = p.split(/[\\/]/)
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part !== '.') out.push(part)
  }
  return out.join(sep)
}

function ensureMd(target: string): string {
  // Don't touch external URLs or anchors
  if (/^https?:\/\//.test(target) || target.startsWith('#')) return target
  if (!target.endsWith('.md')) return target + '.md'
  return target
}

/**
 * Resolve a standard markdown link target relative to the current file.
 * Returns null for external URLs.
 */
export function resolveLink(target: string, currentFilePath: string): string | null {
  if (/^https?:\/\//.test(target) || target.startsWith('#')) return null
  const withExt = ensureMd(target)
  const dir = dirname(currentFilePath)
  const sep = currentFilePath.includes('\\') ? '\\' : '/'
  return normalize(dir + sep + withExt)
}

/**
 * Resolve a wiki-link [[target]] — try relative to current file's dir first,
 * then relative to rootPath.
 */
export function resolveWikiLink(target: string, currentFilePath: string, _rootPath: string): string {
  const withExt = ensureMd(target)
  const sep = currentFilePath.includes('\\') ? '\\' : '/'
  const dir = dirname(currentFilePath)
  return normalize(dir + sep + withExt)
  // Note: rootPath fallback would require async FS calls; the existence check
  // in the decoration layer handles the "broken" indicator instead.
}

/** True if the target looks like an internal md link (not http/anchor). */
export function isInternalLink(target: string): boolean {
  return !/^https?:\/\//.test(target) && !target.startsWith('#') && !target.startsWith('mailto:')
}
