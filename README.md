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

**Phases 0–3 complete**, plus a comprehensive Qt-parity pass (driven by a
full audit of `win/Qt/*`):

- Core compiles to WASM, boots in the browser, renders **graphical tiles** (the
  shipped 5.0 tileset) to canvas, and drives blocking input via Asyncify.
- **Graphical character picker** (qt_plsel.cpp): role/race cards with
  gender-correct monster-tile portraits, validity cross-filtering with
  auto-correction, Random — data generated at build time from `role.c` /
  `monsters.h` (`gen-roles.mjs`), the choice fed to the core via a generated
  `~/.nethackrc` so `genl_player_setup` never prompts.
- **Qt-classic layout**: messages | paperdoll | status across the top, full-
  width map below, with draggable splitters and a collapsible inventory panel
  (all persisted), under one dark design-token theme.
- **Menus with Qt's full interaction model** (qt_menu.cpp): Ok/Cancel/All/
  None/Invert/Search buttons with per-mode enabling, typed-digit counts for
  partial stacks (round-tripped through `menu_item.count`), group
  accelerators, the core's menu command keys, preselection, per-item
  menucolors/attributes, tab-column alignment — plus per-item tile icons.
- **Menubar and toolbar** (qt_main.cpp): Game/Gear/Action/Magic/Info/Help
  menus and the nine icon buttons (XPMs ported by `gen-toolbar-icons.mjs`),
  dispatching extended commands, gated on the core waiting at the prompt.
- **Status panel** as Qt's icon grid (name plate, HP/Pw bars, six attribute
  cards, condition chips) with green/red/blue change-flash highlighting and a
  dense-strip alternative; HP-colored **map cursor** rectangle; blocking
  **--More--** acknowledgment.
- **Settings dialog** (qt_set.cpp) with write-through localStorage
  persistence: tile/text size, status layout, paperdoll visibility,
  hilite_pet/hilite_pile.
- Full save/resume via IndexedDB (IDBFS) with **idle checkpoint flushing**,
  a multi-save-slot picker, and message-log continuity across save/resume.
- **`#` extended-command entry** with typed-prefix autocomplete; the command
  list is generated from `src/cmd.c`'s `extcmdlist[]` with the same defines
  as the WASM core (a host/emcc mismatch here once shifted every command
  index by one — see `gen-extcmds.sh`).
- Status HUD icons from the Qt XPMs, adjustable tile size, startup splash,
  graphical tombstone (`win/X11/rip.xpm`), paper-doll equipment view with
  BUC-tinted borders and click-to-`#seeall`, pet/pile map markers, message
  new/old highlighting, text-window Dismiss/Search, `delay_output` pacing,
  Alt+letter meta commands, F1/F2/Tab macros.

Known gaps (deliberate): ASCII map mode, in-browser help files (`display_file`
reads the core's dlb archive, unreachable from JS), runtime tileset switching,
compact/handheld layout, `yn` count side-channel, and sound.

Next: Tauri desktop shell (Phase 4) — `packages/ui/src/persistence.ts`'s
`Storage` interface is already abstracted for a real-filesystem swap.

## Deploying to GitHub Pages

`.github/workflows/deploy-pages.yml` builds the core from scratch (no build
artifacts are committed) and publishes `packages/ui/dist` on every push to
`main`. It's a **project-page** deploy, served from `/<repo-name>/` rather
than the domain root — every runtime asset fetch in `packages/ui/src` is
prefixed with `base.ts`'s `BASE_URL` (Vite's `import.meta.env.BASE_URL`, set
via `--base=/<repo-name>/` at build time) for exactly that reason. To enable:
in the repo's Settings → Pages, set Source to "GitHub Actions".

Both the Linux CI build path (`hints/linux.500`) and the deploy pipeline have
been verified by real runs — the site deploys on every push to `main`.

## Licensing

The compiled core is **NGPL** (NetHack General Public License), not MIT. The UI is
kept cleanly separated in `packages/ui`. The deployed site links to the license
text (copied from `vendor/nethack/dat/license`) in its footer.
