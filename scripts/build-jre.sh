#!/usr/bin/env bash
# build-jre.sh — Build trimmed JREs for all three platforms using jlink.
#
# Prerequisites:
#   - A JDK 21+ must be on PATH (tested with Eclipse Adoptium / Temurin)
#   - Run this script from the repository root
#   - For cross-platform JREs you need the matching JDK for each platform,
#     or use a CI matrix (see below). Running natively only produces the
#     JRE for the current OS; the others require the respective JDK.
#
# Usage:
#   ./scripts/build-jre.sh [linux|macos|windows|all]   (default: current OS)
#
# Output:
#   src-tauri/resources/jre-linux/
#   src-tauri/resources/jre-macos/
#   src-tauri/resources/jre-windows/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOURCES_DIR="$ROOT_DIR/src-tauri/resources"

# Modules required by PlantUML (verified against plantuml 1.2026.x with --list-deps)
MODULES="java.base,java.desktop,java.xml,java.naming,java.datatransfer,java.prefs"

detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "macos" ;;
    MINGW*|CYGWIN*|MSYS*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

build_jre() {
  local target="$1"
  local out_dir="$RESOURCES_DIR/jre-$target"

  echo "==> Building JRE for $target → $out_dir"
  rm -rf "$out_dir"

  jlink \
    --add-modules "$MODULES" \
    --strip-debug \
    --no-man-pages \
    --no-header-files \
    --compress=2 \
    --output "$out_dir"

  echo "    Done. Size: $(du -sh "$out_dir" | cut -f1)"
}

TARGET="${1:-$(detect_os)}"

case "$TARGET" in
  linux|macos|windows)
    build_jre "$TARGET"
    ;;
  all)
    # Native build only covers the current platform.
    # For other platforms, set JAVA_HOME to the matching cross-platform JDK
    # before calling this script, or use the CI matrix in .github/workflows/.
    CURRENT_OS="$(detect_os)"
    build_jre "$CURRENT_OS"
    echo ""
    echo "NOTE: Cross-platform JREs (for platforms other than $CURRENT_OS) must"
    echo "      be built on the respective platform or via CI."
    echo "      Place them at:"
    echo "        src-tauri/resources/jre-linux/"
    echo "        src-tauri/resources/jre-macos/"
    echo "        src-tauri/resources/jre-windows/"
    ;;
  *)
    echo "Unknown target: $TARGET. Use: linux | macos | windows | all"
    exit 1
    ;;
esac

echo ""
echo "JRE build complete."
