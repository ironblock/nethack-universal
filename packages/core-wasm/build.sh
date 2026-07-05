#!/usr/bin/env bash
#
# Builds the NetHack 5.0.0 core to WebAssembly and copies the artifacts into
# packages/core-wasm/artifacts/ for the UI package to consume.
#
# The heavy lifting is NetHack's own in-tree cross-compile (win/shim window port
# + sys/libnh), documented in vendor/nethack/Cross-compiling section B6. We do
# not maintain a separate emscripten config; we drive the upstream build and
# vendor its output.
#
# Prerequisites:
#   - emscripten SDK activated in the current shell (source emsdk_env.sh)
#   - one-time prep, from vendor/nethack:
#       (cd sys/unix && sh setup.sh hints/macOS.500)   # or hints/linux.500
#       make fetch-lua
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NH="$ROOT/vendor/nethack"
OUT="$ROOT/packages/core-wasm/artifacts"

command -v emcc >/dev/null || { echo "error: emcc not found; source emsdk_env.sh first" >&2; exit 1; }

# Refuse to build on an unpatched submodule (would fail: duplicate symbol +
# missing nhuuid stubs). Run scripts/setup-core.sh first.
if ! git -C "$NH" apply --reverse --check "$ROOT/patches/nethack-5.0.0-web.patch" 2>/dev/null; then
  echo "error: web-port patch not applied to vendor/nethack. Run: bash scripts/setup-core.sh" >&2
  exit 1
fi

# NO_NHUUID=1: hints/macOS.500 enables WANT_NHUUID unconditionally, which pulls
# in macuuid.o (Objective-C / CoreFoundation) — a host-only helper that cannot
# compile to WASM. Disable it for the cross build.
echo ">> Building NetHack 5.0.0 -> WASM (CROSS_TO_WASM=1 NO_NHUUID=1)"
make -C "$NH" CROSS_TO_WASM=1 NO_NHUUID=1

echo ">> Vendoring artifacts into $OUT"
mkdir -p "$OUT"
# nethack.js (Emscripten loader), nethack.wasm (core), and any preloaded data.
cp -v "$NH"/targets/wasm/nethack.js "$OUT"/ 2>/dev/null || true
cp -v "$NH"/targets/wasm/nethack.wasm "$OUT"/ 2>/dev/null || true
cp -v "$NH"/targets/wasm/nethack.data "$OUT"/ 2>/dev/null || true

# Also stage into the UI package's public dir so Vite serves them at /core/.
UI_CORE="$ROOT/packages/ui/public/core"
mkdir -p "$UI_CORE"
cp -f "$OUT"/nethack.js "$OUT"/nethack.wasm "$UI_CORE"/ 2>/dev/null || true

echo ">> Done. Artifacts:"
ls -la "$OUT"
