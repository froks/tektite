# Tektite

> Vibe-coded. Entirely. No regrets.

A minimal Obsidian-style markdown editor for the desktop, built with Tauri v2, Vue 3, and CodeMirror 6.

## Features

- **Hybrid live preview** — bold, italic, strikethrough, headings, links, tables, and code blocks render in-place while you type. Syntax markers hide on inactive lines and reappear when your cursor moves there.
- **File explorer** — open any folder, browse a tree of `.md` files and subdirectories. Sidebar is resizable by dragging and collapsible to a slim strip. Right-click any entry for "New File", "New Folder", "Open Containing Folder", "Copy Path", or "Rename"; right-click empty space for the same create options. Filter the tree with the search bar at the bottom — parent folders auto-expand around matches.
- **Live file watching** — the sidebar refreshes automatically when files or folders are created, deleted, or renamed externally. If the currently open file is modified outside the app (and has no unsaved edits), its content reloads in place without resetting the cursor.
- **Search** — in-editor text search with match highlighting and prev/next navigation (Ctrl+F).
- **Wiki-links** — `[[target]]` and `[[target|display]]` syntax supported. Broken links shown with a dashed underline.
- **Fenced code blocks** — syntax-highlighted background, hidden fences when inactive, copy-to-clipboard button.
- **Task lists** — `- [ ]` / `- [x]` rendered as clickable checkboxes.
- **Tables** — GFM tables styled with header/row borders; separator row collapsed to a clean dividing line.
- **Horizontal rules** — rendered as a full-width line widget.
- **Blockquotes** — left-accent border, muted italic style.

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| UI framework | Vue 3 + TypeScript |
| Editor | CodeMirror 6 |
| Markdown parser | @lezer/markdown (GFM) |
| Build tool | Vite + Bun |

## Getting started

**Prerequisites:** [Rust](https://rustup.rs), [Bun](https://bun.sh), and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

On Debian/Ubuntu, install the required system libraries:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libgdk-pixbuf-2.0-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev
```

```bash
bun install
bun tauri dev
```

To build a release binary:

```bash
bun tauri build
```

## Project structure

```
src/
  components/
    FileSidebar.vue       # Resizable/collapsible sidebar, file tree, filter bar, fs watcher
    FileTreeNode.vue      # Recursive tree node, inline rename, context menu (new file/folder)
    MarkdownEditor.vue    # CodeMirror 6 setup, theme, keybindings
    SearchPanel.vue       # In-editor search UI (Ctrl+F)
  editor/
    markdownDecorations.ts  # Lezer-tree decoration engine
    linkResolver.ts         # Wiki-link / relative link resolution
  App.vue                 # Root layout, sidebar resize/collapse, file load/save
src-tauri/
  src/lib.rs              # Rust commands: read/write/list/rename/exists/watch
```

## Notes

Decoration rendering walks the Lezer syntax tree (`syntaxTree` from `@codemirror/language`) rather than using regexes over raw text. This gives correctly nested, positionally exact decorations with no overlap issues.

Internal link existence is checked asynchronously via a Tauri `file_exists` command and cached per session; broken links are styled distinctly.
