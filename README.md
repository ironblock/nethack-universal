# nethack-universal

A browser-first **NetHack 5.0.0** client with full graphical-tile play, targeting
better-than-Qt feature parity — architected so a desktop build (Tauri) follows
with maximal code reuse. "Web now, desktop later."

## Layers

```
UI layer (TypeScript)        packages/ui        ← all the differentiation
  tile renderer (canvas2d) · clickable menus/inventory · mouse map
  interaction · chorded-diagonal input · status HUD · prompts · options

Shim / window port (C→WASM)  vendor/nethack/win/shim   ← upstream, not forked
  implements struct window_procs; marshals every call to a JS callback

NetHack 5.0.0 core (C→WASM)  packages/core-wasm ← build wrapper over vendored core
  + embedded Lua + packaged data/.lua files
```

Unlike the original brief assumed, NetHack 5.0.0 **ships its own emscripten
cross-compile in-tree** (`win/shim` + `sys/libnh`, the upstreamed neth4ck
approach). We drive that build rather than writing a window port from scratch;
see [packages/core-wasm/README.md](packages/core-wasm/README.md).

## Layout

- `vendor/nethack/` — NetHack 5.0.0 source (NGPL), a **git submodule** pinned to the
  `NetHack-5.0.0_Released` tag, kept pristine. Builds into itself; artifacts gitignored.
- `patches/` — our source changes, applied on top of the pristine submodule.
- `scripts/setup-core.sh` — one-time core prep (submodule + patch + setup + Lua).
- `packages/core-wasm/` — build wrapper that produces `nethack.js` / `nethack.wasm`.
- `packages/ui/` — the TypeScript UI (Vite). Phase-0 harness today; Phases 1–3 next.

## Getting started

Requires Node, the emscripten SDK, and a C toolchain.

```
git clone --recurse-submodules <this repo>      # or: git submodule update --init
npm install
source ~/emsdk/emsdk_env.sh                      # activate emscripten
bash scripts/setup-core.sh                        # one-time: patch + configure the core
npm run build:core                                # build nethack.wasm
npm run dev -w @nethack-universal/ui              # http://localhost:5173
```

## Status

**Phases 0–1 complete** — the 5.0.0 core compiles to WASM, boots in the browser,
renders **graphical tiles** to a canvas (the shipped 5.0 tileset, 2303 tiles incl.
statues), runs the real move loop, follows the hero, and responds to input (blocking
input via Asyncify). Tile assets are generated from source by
`packages/core-wasm/gen-tiles.sh` (host `tilemap`/`tile2bmp` → PNG + `glyph2tile.json`).

Next: clickable menus/inventory and mouse (Phase 2), then persistence/options (Phase 3),
then the Tauri desktop shell (Phase 4).

## Licensing

The compiled core is **NGPL** (NetHack General Public License), not MIT. The UI is
kept cleanly separated in `packages/ui`. Read the license before publishing.
