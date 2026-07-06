#!/usr/bin/env bash
#
# Generate packages/ui/public/extcmds.json: the extended-command list
# (name/description/flags), extracted from vendor/nethack/src/cmd.c's
# extcmdlist[] array by preprocessing it with the same defines our WASM
# build uses (so CMD_NOT_AVAILABLE reflects our actual SHELL/SUSPEND-less
# environment) and parsing the macro-expanded C literal with Node.
#
# Host cc only (not emcc) — we just need the preprocessor, not codegen.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NH="$ROOT/vendor/nethack"
OUT="$ROOT/packages/core-wasm/artifacts/cmd.i"

mkdir -p "$(dirname "$OUT")"

echo ">> Preprocessing src/cmd.c with the WASM build's defines"
( cd "$NH" && cc \
    -DGNU_LIBC -DSYSCF -DSYSCF_FILE=\"/sysconf\" -DSECURE \
    -I include -I sys/unix -DNOTPARMDECL -DDLB -DCHDIR \
    -DVAR_PLAYGROUND=\"/nethack-data\" -DHACKDIR=\"/\" \
    -DDEFAULT_WINDOW_SYS=\"shim\" -DNOMAIL -Ilib/lua-5.4.8/src/src \
    -DNOTTYGRAPHICS -DSHIM_GRAPHICS -DLIBNH -DCROSSCOMPILE \
    -E src/cmd.c -o "$OUT" )

echo ">> Parsing extcmdlist[] -> packages/ui/public/extcmds.json"
node "$ROOT/packages/core-wasm/tools/gen-extcmds.mjs" "$OUT"
