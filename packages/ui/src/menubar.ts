/**
 * Menubar + toolbar (qt_main.cpp's Game/Gear/Action/Magic/Info/Help menus and
 * the nine-button toolbar).
 *
 * Every entry dispatches an extended command by name — the web analog of Qt's
 * doKeys('#cmdname\n') injection: main.ts primes ExtCmdController with the
 * name and pushes '#' into the input queue, so the core's own get_ext_cmd /
 * command dispatch runs it (we never call game functions directly). Names are
 * cmd.c extcmdlist[] names, checked against extcmds.json at startup so a
 * renamed command degrades to a console warning instead of a dead menu item.
 *
 * Like Qt's ok_for_command gating, dispatch is refused (button flashes)
 * unless the core is actually waiting at the command prompt (nh_poskey) —
 * clicking "Pray" mid-getlin would otherwise type '#' into the prompt.
 */

type MenuEntry = [label: string, cmd: string] | null; // null = separator

// Transcribed from qt_main.cpp:588-696 (desktop entries), mapped to
// extcmdlist names. "Extended-commands" uses the bare '#' palette.
const MENUS: Array<[title: string, entries: MenuEntry[]]> = [
  [
    "Game",
    [
      ["Extended commands…", "#"],
      null,
      ["Version", "version"],
      ["History", "history"],
      ["Options", "optionsfull"],
      ["Explore mode", "exploremode"],
      null,
      ["Save and exit", "save"],
      ["Quit without saving", "quit"],
    ],
  ],
  [
    "Gear",
    [
      ["Remove many", "takeoffall"],
      null,
      ["Wield weapon", "wield"],
      ["Exchange weapons", "swap"],
      ["Two-weapon combat", "twoweapon"],
      ["Load quiver", "quiver"],
      null,
      ["Wear armor", "wear"],
      ["Take off armor", "takeoff"],
      null,
      ["Put on accessories", "puton"],
      ["Remove accessories", "remove"],
    ],
  ],
  [
    "Action",
    [
      ["Apply", "apply"],
      ["Chat", "chat"],
      ["Close door", "close"],
      ["Down", "down"],
      ["Drop many", "droptype"],
      ["Drop", "drop"],
      ["Eat", "eat"],
      ["Engrave", "engrave"],
      ["Fire from quiver", "fire"],
      ["Force", "force"],
      ["Jump", "jump"],
      ["Kick", "kick"],
      ["Loot", "loot"],
      ["Open door", "open"],
      ["Pay", "pay"],
      ["Pick up", "pickup"],
      ["Rest", "wait"],
      ["Ride", "ride"],
      ["Search", "search"],
      ["Sit", "sit"],
      ["Throw", "throw"],
      ["Untrap", "untrap"],
      ["Up", "up"],
      ["Wipe face", "wipe"],
    ],
  ],
  [
    "Magic",
    [
      ["Quaff potion", "quaff"],
      ["Read scroll/book", "read"],
      ["Zap wand", "zap"],
      ["Cast spell", "cast"],
      ["Dip", "dip"],
      ["Rub", "rub"],
      ["Invoke", "invoke"],
      null,
      ["Offer", "offer"],
      ["Pray", "pray"],
      null,
      ["Teleport", "teleport"],
      ["Monster action", "monster"],
      ["Turn undead", "turn"],
    ],
  ],
  [
    "Info",
    [
      ["Inventory", "inventory"],
      ["Attributes", "attributes"],
      ["Overview", "overview"],
      ["Conduct", "conduct"],
      ["Discoveries", "known"],
      ["Spells", "showspells"],
      ["Adjust inventory letters", "adjust"],
      null,
      ["Name object or creature", "name"],
      ["Annotate level", "annotate"],
      null,
      ["Skills", "enhance"],
    ],
  ],
  [
    "Help",
    [
      ["Help", "help"],
      null,
      ["What is here", "look"],
      ["What is there", "glance"],
      ["What is…", "whatis"],
    ],
  ],
];

// Toolbar (qt_main.cpp:844-853): icon name under /toolbar/, label, command.
const TOOLBAR: Array<[icon: string, label: string, cmd: string]> = [
  ["again", "Again", "repeat"],
  ["pickup", "Pick up", "pickup"],
  ["drop", "Drop", "droptype"],
  ["kick", "Kick", "kick"],
  ["throw", "Throw", "throw"],
  ["fire", "Fire", "fire"],
  ["eat", "Eat", "eat"],
  ["search", "Search", "search"],
  ["rest", "Rest", "wait"],
];

export interface MenubarHost {
  /** Dispatch an extended command by name ('#' = open the palette). Returns false if refused. */
  dispatch(cmd: string): boolean;
  /** Names that actually exist in extcmds.json (for degrading missing ones). */
  hasCommand(cmd: string): boolean;
  baseUrl: string;
}

export function wireMenubar(container: HTMLElement, toolbarEl: HTMLElement, host: MenubarHost): void {
  let openMenu: HTMLElement | null = null;
  const closeAll = () => {
    openMenu?.classList.remove("open");
    openMenu = null;
  };
  window.addEventListener("click", closeAll);

  for (const [title, entries] of MENUS) {
    const item = document.createElement("div");
    item.className = "menubar-menu";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = title;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = item.classList.contains("open");
      closeAll();
      if (!wasOpen) {
        item.classList.add("open");
        openMenu = item;
      }
    });
    btn.addEventListener("mouseenter", () => {
      // Qt behavior: once a menu is open, hovering moves between menus.
      if (openMenu && openMenu !== item) {
        closeAll();
        item.classList.add("open");
        openMenu = item;
      }
    });
    item.appendChild(btn);

    const drop = document.createElement("div");
    drop.className = "menubar-drop";
    for (const entry of entries) {
      if (!entry) {
        const sep = document.createElement("div");
        sep.className = "menubar-sep";
        drop.appendChild(sep);
        continue;
      }
      const [label, cmd] = entry;
      if (cmd !== "#" && !host.hasCommand(cmd)) {
        console.warn(`[menubar] extended command "${cmd}" missing; hiding "${label}"`);
        continue;
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "menubar-item";
      row.textContent = label;
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        closeAll();
        if (!host.dispatch(cmd)) flash(btn);
      });
      drop.appendChild(row);
    }
    item.appendChild(drop);
    container.appendChild(item);
  }

  for (const [icon, label, cmd] of TOOLBAR) {
    if (!host.hasCommand(cmd)) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toolbar-btn";
    b.title = label;
    const img = document.createElement("img");
    img.src = `${host.baseUrl}toolbar/${icon}.png`;
    img.alt = label;
    img.width = 18;
    img.height = 19;
    b.appendChild(img);
    b.addEventListener("click", () => {
      if (!host.dispatch(cmd)) flash(b);
    });
    toolbarEl.appendChild(b);
  }
}

/** Qt beeps and drops the command when the core isn't at a prompt; we flash. */
function flash(el: HTMLElement): void {
  el.classList.add("refused");
  setTimeout(() => el.classList.remove("refused"), 300);
}
