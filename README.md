# Tektite

> Vibe-coded. Entirely. No regrets.

A minimal Obsidian-style markdown editor for the desktop, built with Tauri v2, Vue 3, and CodeMirror 6.

## Features

- **Hybrid live preview** — bold, italic, strikethrough, headings, links, tables, and code blocks render in-place while you type. Syntax markers hide on inactive lines and reappear when your cursor moves there.
- **File explorer** — open any folder, browse a tree of `.md`, `.txt`, `.pdf`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.avif`, and `.svg` files across subdirectories. Sidebar is resizable by dragging and collapsible to a slim strip. Right-click any entry for "New File" or "New Folder"; right-click empty space for the same. Filter the tree with the search bar at the bottom — parent folders auto-expand around matches.
- **Live file watching** — the sidebar refreshes automatically when files or folders are created, deleted, or renamed externally. If the currently open file is modified outside the app (and has no unsaved edits), its content reloads in place without resetting the cursor.
- **Tabs** — open multiple files in tabs with unsaved-change indicators. Switching tabs restores in-memory content. Ctrl+W closes the active tab; middle-click a tab to close it.
- **Auto-save** — editor changes are automatically persisted to disk after 800ms of inactivity. Ctrl+S saves immediately.
- **Search** — in-editor text search with match highlighting and prev/next navigation (Ctrl+F). Search state carries across file switches.
- **Wiki-links** — `[[target]]` and `[[target|display]]` syntax supported. Broken links shown with a dashed underline.
- **Standard markdown links** — `[text](target)` links resolved relative to the current file's directory; missing `.md` extension auto-appended.
- **Fenced code blocks** — syntax-highlighted background, hidden fences when inactive, copy-to-clipboard button. Supports PHP and all languages from CodeMirror's language-data.
- **PlantUML diagrams** — ` ```plantuml ` code blocks render as inline diagrams (SVG, PNG, EPS, text/ASCII, LaTeX, or PDF output). An edit button appears on hover.
- **Task lists** — `- [ ]` / `- [x]` rendered as clickable checkboxes that toggle the marker.
- **Tables** — GFM tables styled with header/row borders; separator row collapsed to a clean dividing line. Column alignment (left, center, right) is respected.
- **Horizontal rules** — rendered as a full-width line widget.
- **Blockquotes** — left-accent border, muted italic style, with support for nested blockquotes.
- **PDF viewer** — full PDF rendering with zoom in/out, reset-to-fit, page counter, and text search with match navigation (Ctrl+F).
- **Image viewer** — zoom, pan, and rotate for images. Supports jpg, jpeg, png, gif, webp, avif, and svg. Scroll to zoom, drag to pan.

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| UI framework | Vue 3 + TypeScript |
| Editor | CodeMirror 6 |
| Markdown parser | @lezer/markdown (GFM) |
| PDF rendering | pdfjs-dist |
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

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl/Cmd + S | Save current file |
| Ctrl/Cmd + F | Open search |
| Ctrl/Cmd + W | Close active tab |
| Enter | Next search match |
| Shift + Enter | Previous search match |
| Escape | Close search |

## Notes

Decoration rendering walks the Lezer syntax tree (`syntaxTree` from `@codemirror/language`) rather than using regexes over raw text. This gives correctly nested, positionally exact decorations with no overlap issues.

Internal link existence is checked asynchronously via a Tauri `file_exists` command and cached per session; broken links are styled distinctly.

Tektite follows your system's `prefers-color-scheme` for light/dark theme. PlantUML rendering uses a bundled JRE and `plantuml.jar` shipped with the app. The last opened folder is persisted and restored on startup, and a folder can also be opened via CLI argument (`tektite /path/to/folder`).
