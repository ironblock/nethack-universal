/**
 * Phase-0 bootstrap: load the WASM core, register the window-proc callback
 * before `main` auto-runs, and point NetHack at the embedded data.
 *
 * Ordering matters. `main()` (in sys/libnh/libnhmain.c) auto-runs during module
 * init and immediately starts calling window procs. `js_helpers_init()` (which
 * installs the pointer helpers the shim needs) also runs inside `main`. So we
 * register our callback in `onRuntimeInitialized`, which emscripten fires just
 * before `callMain`, guaranteeing the shim sees a callback from the first proc.
 */
import type { NetHackFactory, NetHackModule } from "./emscripten";
import { NetHackUI } from "./nethack";
import { attachKeyboard } from "./input";
import { TileRenderer } from "./tiles";
import { MenuController, PermInventPanel } from "./menu";
import { PaperdollPanel } from "./paperdoll";
import { PromptController } from "./prompt";
import { IdbfsStorage } from "./persistence";
import { SaveSelectController } from "./saveselect";
import { CharPickController } from "./charpick";
import { TextWindowController } from "./textwindow";
import { TombstoneController } from "./tombstone";
import { ExtCmdController } from "./extcmd";
import { wireLayout } from "./layout";
import { wireMenubar } from "./menubar";
import { loadSettings, applySettings, wireSettingsDialog, settingsRcLines } from "./settings";
import { StatusIcons } from "./statusicons";
import { BASE_URL } from "./base";

const CALLBACK_NAME = "nethackCallback";

async function boot(): Promise<void> {
  const dismissSplash = wireSplashScreen();
  (byId("license-link") as HTMLAnchorElement).href = `${BASE_URL}LICENSE-NETHACK.txt`;

  const dom = {
    messages: byId("messages"),
    status: byId("status"),
  };

  const renderer = new TileRenderer();
  await renderer.load();
  renderer.attach(byId("map") as HTMLCanvasElement);
  wireLayout();

  const menuCtl = new MenuController(byId("overlay"), renderer);
  const promptCtl = new PromptController(byId("overlay"));
  const textWinCtl = new TextWindowController(byId("overlay"));
  const tombstoneCtl = new TombstoneController(byId("overlay"));
  const permInvent = new PermInventPanel(byId("perminvent"), renderer);
  const paperdoll = new PaperdollPanel(byId("paperdoll"), renderer);
  const extCmdCtl = new ExtCmdController(byId("overlay"));
  await extCmdCtl.load();
  const statusIcons = new StatusIcons();
  await statusIcons.load();

  const ui = new NetHackUI();
  // The shim looks up the callback by name on globalThis.
  (globalThis as Record<string, unknown>)[CALLBACK_NAME] = ui.callback;
  (globalThis as Record<string, unknown>).__nh = { ui, renderer, menuCtl, promptCtl, tombstoneCtl }; // debug handle
  attachKeyboard(ui.input);
  // Click a map cell to travel there (left) or look (right).
  renderer.onCellClick((x, y, button) => ui.input.push({ kind: "mouse", x, y, button }));

  // Settings (qt_set.cpp): persisted write-through; re-applied every boot.
  const settings = loadSettings();
  const settingsHost = { renderer, setStatusLayout: (l: Parameters<typeof ui.setStatusLayout>[0]) => ui.setStatusLayout(l) };
  applySettings(settings, settingsHost);
  wireSettingsDialog(byId("settings-btn"), byId("overlay"), settingsHost);

  // Menubar + toolbar (qt_main.cpp): items dispatch extended commands by
  // priming the '#' palette, gated on the core waiting at a command prompt.
  wireMenubar(byId("menubar"), byId("toolbar"), {
    baseUrl: BASE_URL,
    hasCommand: (cmd) => cmd === "#" || extCmdCtl.has(cmd),
    dispatch: (cmd) => {
      if (!ui.awaitingCommand) return false;
      if (cmd !== "#" && !extCmdCtl.prime(cmd)) return false;
      ui.input.pushKey("#".charCodeAt(0));
      return true;
    },
  });

  // Emscripten ES6 module: default export is the factory. It lives in /public
  // and is served as-is; hide the specifier from Vite's import-analysis so the
  // browser does a native runtime import instead of a build-time transform.
  const nativeImport = new Function("u", "return import(u)") as (u: string) => Promise<{
    default: NetHackFactory;
  }>;
  const { default: factory } = await nativeImport(`${BASE_URL}core/nethack.js`);

  const mod: Partial<NetHackModule> = {
    // Don't auto-run main(); we start it ourselves after the callback is wired,
    // so the shim never sees a null callback (which would spin nhgetch and peg
    // the main thread instead of suspending via Asyncify).
    noInitialRun: true,
    locateFile: (path) => `${BASE_URL}core/${path}`,
    print: (s) => console.log("[nh stdout]", s),
    printErr: (s) => console.log("[nh stderr]", s),
    preRun: [
      () => {
        const m = mod as NetHackModule;
        m.ENV.NETHACKDIR = "/"; // embedded data (nhdat, sysconf) is at FS root
        m.ENV.HACKDIR = "/";
        m.ENV.USER = "Adventurer"; // placeholder; overwritten after the save-select screen
        // !tutorial keeps the 5.0 tutorial prompt off; !legacy skips the intro
        // poem's --More--; time/showexp drive the status line. hilite_pet/
        // hilite_pile moved to the generated .nethackrc (settings.ts) — the
        // RC file is read BEFORE this env var, and env "extra options" would
        // override it, so user-facing toggles must not live here.
        m.ENV.NETHACKOPTIONS = "!tutorial,!legacy,time,showexp";
      },
    ],
  };

  const m = await factory(mod);

  // Mount persistent storage and load any saved game BEFORE main() runs, so the
  // core finds an existing save under our player name and offers to restore it.
  const storage = new IdbfsStorage(m);
  storage.mount();
  await storage.load();
  window.addEventListener("pagehide", () => void storage.save());

  // Qt's qt_svsel.cpp: pick an existing saved adventurer to resume, or start a
  // new one. Saves are parsed from "<uid><plname>" filenames (files.c
  // set_savefile_name) — our WASM build has a fixed uid, so it's just a
  // leading digit run to strip. A new adventurer continues into the graphical
  // character picker (qt_plsel.cpp); its choice reaches the core purely via
  // options, so genl_player_setup finds a fully-specified character and never
  // shows its fallback menus. Backing out of the picker returns to this screen.
  dismissSplash();
  const saveSelectCtl = new SaveSelectController(byId("saveselect"));
  const charPickCtl = new CharPickController(byId("saveselect"), renderer);
  await charPickCtl.load();
  let playerName: string;
  // ENV mutations after runtime init don't reach the core (emscripten
  // snapshots the environment), so per-session options go through the RC
  // file: cfgfiles.c reads $HOME/.nethackrc (HOME defaults to /home/web_user
  // in emscripten's MEMFS) during initoptions, then applies NETHACKOPTIONS —
  // the static prefs — on top as extra options. Persisted settings always
  // contribute lines; a new character adds its role/race/gender/align.
  let rc = settingsRcLines(settings);
  for (;;) {
    const save = await saveSelectCtl.choose(storage.listSaves());
    if (save.kind === "resume") {
      playerName = save.name;
      break;
    }
    const choice = await charPickCtl.pick(save.name);
    if (!choice) continue; // Back → save select again
    playerName = choice.name;
    rc += `OPTIONS=role:${choice.role}\nOPTIONS=race:${choice.race}\nOPTIONS=gender:${choice.gender}\nOPTIONS=align:${choice.align}\n`;
    break;
  }
  m.FS.writeFile("/home/web_user/.nethackrc", rc);
  m.ENV.USER = playerName;

  ui.bind(m, dom, renderer, menuCtl, promptCtl, storage, textWinCtl, permInvent, extCmdCtl, statusIcons, tombstoneCtl, paperdoll);
  m.ccall("shim_graphics_set_callback", null, ["string"], [CALLBACK_NAME]);
  console.log("[nethack] callback registered; starting main()");

  // Asyncify: callMain returns as soon as the core suspends for input.
  try {
    m.callMain(["-u", playerName]);
  } catch (e) {
    if (!isExitStatus(e)) throw e;
  }
}

function isExitStatus(e: unknown): boolean {
  return typeof e === "object" && e !== null && "status" in e;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

/** Qt shows a version/attribution splash at startup and character select. */
function wireSplashScreen(): () => void {
  const splash = byId("splash");
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    splash.classList.add("hidden");
    window.removeEventListener("keydown", dismiss, true);
    window.removeEventListener("click", dismiss, true);
    setTimeout(() => splash.remove(), 350);
  };
  window.addEventListener("keydown", dismiss, true);
  window.addEventListener("click", dismiss, true);
  return dismiss;
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById("messages");
  if (el) el.textContent = `boot error: ${err?.message ?? err}`;
});
