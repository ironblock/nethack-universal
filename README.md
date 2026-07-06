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
- `packages/ui/` — the TypeScript UI (Vite): tiles, menus, status HUD, prompts,
  persistence, and extended-command entry.

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

**Phases 0–3 complete**, plus most of the Qt-parity pass:

- Core compiles to WASM, boots in the browser, renders **graphical tiles** (the
  shipped 5.0 tileset) to canvas, and drives blocking input via Asyncify.
- Clickable menus (inventory, selection, category headers, paging), a docked
  always-visible `perm_invent` panel, mouse click-to-travel/look, interactive
  y/n and text prompts, and a two-line status HUD.
- Full save/resume via IndexedDB (IDBFS).
- **`#` extended-command entry** with typed-prefix autocomplete (mirrors the Qt
  port's behavior — unambiguous prefixes select immediately) — this unlocks
  everything else routed through NetHack's generic menu system for free,
  including the in-game **options editor** (`#optionsfull`), `#overview`,
  `#terrain`, `#conduct`, `#version`, and dozens more. The command list itself
  is generated at build time from `src/cmd.c`'s `extcmdlist[]`
  (`packages/core-wasm/gen-extcmds.sh`), not hand-maintained.
- **Status HUD icons** for the six attributes, alignment, hunger, encumbrance,
  and status conditions, ported from the Qt port's XPM assets
  (`win/Qt/qt_xpms.h`, same license) at build time
  (`packages/core-wasm/tools/gen-status-icons.mjs`) — plus a color-coded HP bar.
- **Adjustable tile size** (+/− controls in the header), redrawn instantly from
  a client-side glyph cache — no core round-trip needed.

Remaining for full Qt parity (both low-priority / explicitly optional per the
original brief): runtime tileset switching, and long-menu "paging" (already
effectively handled via scroll).

Next: Tauri desktop shell (Phase 4) — `packages/ui/src/persistence.ts`'s
`Storage` interface is already abstracted for a real-filesystem swap.

## Licensing

The compiled core is **NGPL** (NetHack General Public License), not MIT. The UI is
kept cleanly separated in `packages/ui`. Read the license before publishing.
