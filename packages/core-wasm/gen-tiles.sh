#!/usr/bin/env bash
#
# Generate the browser tile assets (packages/ui/public/tiles/): builds the host
# tile tools, emits the canonical tilesheet + glyph→tile mapping from source,
# then converts to PNG/JSON via tools/gen-tiles.mjs.
#
# Host tools only (cc, not emcc) — independent of the WASM build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NH="$ROOT/vendor/nethack"

echo ">> Generating src/tile.c (glyph→tile mapping) via util/tilemap"
( cd "$NH/util" && make ../src/tile.c )

echo ">> Building util/tile2bmp and rendering nhtiles.bmp"
( cd "$NH/util" && make tile2bmp )
( cd "$NH/dat" && ../util/tile2bmp nhtiles.bmp )

echo ">> Converting to PNG + glyph2tile.json"
node "$ROOT/packages/core-wasm/tools/gen-tiles.mjs"
