#!/usr/bin/env bash
#
# One-time prep for building the NetHack core to WASM. Idempotent — safe to
# re-run. After this, `npm run build:core` produces the artifacts.
#
# The vendor/nethack submodule is kept pristine at the NetHack-5.0.0_Released
# tag; our source changes live in patches/ and are applied on top here. See
# packages/core-wasm/README.md for what each delta does.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NH="$ROOT/vendor/nethack"
PATCH="$ROOT/patches/nethack-5.0.0-web.patch"

echo ">> Ensuring submodule is checked out"
git -C "$ROOT" submodule update --init vendor/nethack

echo ">> Applying web-port patch (if not already applied)"
if git -C "$NH" apply --reverse --check "$PATCH" 2>/dev/null; then
  echo "   already applied"
  PATCH_JUST_APPLIED=0
else
  git -C "$NH" apply "$PATCH"
  echo "   applied $PATCH"
  PATCH_JUST_APPLIED=1
fi

# setup.sh generates src/Makefile from the (patched) hints, so it must run after
# the patch. Re-run it if the Makefile is missing or the patch just landed.
if [ ! -f "$NH/src/Makefile" ] || [ "$PATCH_JUST_APPLIED" = "1" ]; then
  echo ">> Running setup.sh (hints/macOS.500)"
  (cd "$NH/sys/unix" && sh setup.sh hints/macOS.500)
fi

if ! ls "$NH"/lib/lua-*/src/lua.h >/dev/null 2>&1; then
  echo ">> Fetching Lua"
  make -C "$NH" fetch-lua
fi

echo ">> Generating tile assets"
bash "$ROOT/packages/core-wasm/gen-tiles.sh"

echo ">> Generating extended-command list"
bash "$ROOT/packages/core-wasm/gen-extcmds.sh"

echo ">> Generating status icons (ported from the Qt port's XPMs)"
node "$ROOT/packages/core-wasm/tools/gen-status-icons.mjs"

echo ">> Generating map-cell marker icons (pet/pile, ported from qt_map.cpp)"
node "$ROOT/packages/core-wasm/tools/gen-map-marks.mjs"

echo ">> Core prep complete. Now run: npm run build:core"
