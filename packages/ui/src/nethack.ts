/**
 * The NetHack window-proc callback.
 *
 * The WASM shim (`win/shim/winshim.c`) marshals every `window_procs` call to a
 * single JS callback registered via `shim_graphics_set_callback`. It invokes us
 * as `callback(name, ...args)` and expects a Promise whose resolved value is the
 * proc's return value (written back through `setPointerValue`).
 *
 * Phase 1: graphical tiles blitted to a canvas (TileRenderer), a scrolling
 * message log, and keyboard input. Menus, mouse, and the HUD come in Phase 2;
 * unhandled procs are logged so we can see what the core asks for next.
 */
import type { NetHackModule } from "./emscripten";
import { InputQueue } from "./input";
import type { TileRenderer } from "./tiles";
import type { MenuController, MenuItem, PermInventPanel } from "./menu";
import type { PaperdollPanel } from "./paperdoll";
import type { PromptController } from "./prompt";
import type { Storage } from "./persistence";
import type { TextWindowController } from "./textwindow";
import { TombstoneController } from "./tombstone";
import type { ExtCmdController } from "./extcmd";
import type { StatusIcons } from "./statusicons";
import { StatusBar, BL_FLUSH, BL_RESET, BL_CONDITION } from "./status";
import type { StatusLayout } from "./status";

// include/wintype.h
const NHW = { MESSAGE: 1, STATUS: 2, MAP: 3, MENU: 4, TEXT: 5, PERMINVENT: 6 } as const;
// include/wintype.h: signals perm_invent on start_menu; WIN_INVEN is otherwise
// an ordinary NHW_MENU (never actually typed NHW_PERMINVENT in practice).
const MENU_BEHAVE_PERMINV = 0x1;

// glyph_info layout (include/wintype.h): int glyph@0; int ttychar@4;
// uint32 framecolor@8; glyph_map gm@12 (gm.glyphflags is gm's first field).
const GLYPHINFO_GLYPH_OFFSET = 0;
const GLYPHINFO_FLAGS_OFFSET = 12;
// include/display.h
const MG_PET = 0x00010;
const MG_OBJPILE = 0x00080;

interface Dom {
  messages: HTMLElement;
  status: HTMLElement;
}

export class NetHackUI {
  readonly input = new InputQueue();

  private mod!: NetHackModule;
  private dom!: Dom;
  private renderer!: TileRenderer;
  private menuCtl!: MenuController;
  private permInvent!: PermInventPanel;
  private paperdoll!: PaperdollPanel;
  private promptCtl!: PromptController;
  private storage!: Storage;
  private textWinCtl!: TextWindowController;
  private tombstoneCtl!: TombstoneController;
  private extCmdCtl!: ExtCmdController;
  private status!: StatusBar;

  private windowType = new Map<number, number>();
  private nextWinid = 1;
  private menus = new Map<number, { items: MenuItem[]; prompt: string; permInvent: boolean }>();
  private textBuffers = new Map<number, string[]>();

  private seenProcs = new Set<string>();

  bind(
    mod: NetHackModule,
    dom: Dom,
    renderer: TileRenderer,
    menuCtl: MenuController,
    promptCtl: PromptController,
    storage: Storage,
    textWinCtl: TextWindowController,
    permInvent: PermInventPanel,
    extCmdCtl: ExtCmdController,
    statusIcons: StatusIcons,
    tombstoneCtl: TombstoneController,
    paperdoll: PaperdollPanel,
  ): void {
    this.mod = mod;
    this.dom = dom;
    this.renderer = renderer;
    this.menuCtl = menuCtl;
    this.promptCtl = promptCtl;
    this.storage = storage;
    this.textWinCtl = textWinCtl;
    this.permInvent = permInvent;
    this.paperdoll = paperdoll;
    this.extCmdCtl = extCmdCtl;
    this.tombstoneCtl = tombstoneCtl;
    this.status = new StatusBar(dom.status, statusIcons);
  }

  /** Qt's statuslines:2 ("compact") vs :3 ("spread") — see status.ts. */
  setStatusLayout(layout: StatusLayout): void {
    this.status.setLayout(layout);
    this.status.render();
  }

  /** True while the core is suspended at the main command prompt (nh_poskey). */
  awaitingCommand = false;

  /** Set true to trace every window-proc call to the console (capped). */
  debug = false;
  private callCount = 0;

  /** Registered on globalThis; the shim calls this for every window proc. */
  callback = async (name: string, ...args: unknown[]): Promise<unknown> => {
    if (this.debug && this.callCount < 200) {
      console.log(`[proc ${this.callCount}]`, name, JSON.stringify(args));
    }
    this.callCount++;

    switch (name) {
      case "shim_create_nhwindow": {
        const type = args[0] as number;
        const id = this.nextWinid++;
        this.windowType.set(id, type);
        return id;
      }
      case "shim_clear_nhwindow": {
        if (this.windowType.get(args[0] as number) === NHW.MAP) this.renderer.clear();
        return;
      }
      case "shim_display_nhwindow": {
        const window = args[0] as number;
        const blocking = args[1] as number | boolean;
        const type = this.windowType.get(window);
        if (type === NHW.TEXT) {
          const lines = this.textBuffers.get(window);
          if (lines?.length) {
            if (TombstoneController.isTombstone(lines)) await this.tombstoneCtl.show(lines);
            else await this.textWinCtl.show(lines);
          }
        } else if (blocking && (type === NHW.MESSAGE || type === NHW.MAP)) {
          // Qt appends "--More--" and blocks for space/Enter/Esc (qt_more,
          // qt_bind.cpp:766-838); same for "press a key when done viewing
          // the map". Without this, MSGTYPE=stop bursts and level feelings
          // scroll past unacknowledged.
          await this.more();
        }
        return;
      }
      case "shim_destroy_nhwindow":
        this.windowType.delete(args[0] as number);
        this.textBuffers.delete(args[0] as number);
        return;

      case "shim_print_glyph": {
        const x = args[1] as number;
        const y = args[2] as number;
        const glyphinfo = args[3] as number;
        const bkglyphinfo = args[4] as number;
        // Draw the background glyph (e.g. floor) first, then the foreground.
        if (bkglyphinfo) {
          this.renderer.drawGlyph(x, y, this.mod.getValue(bkglyphinfo + GLYPHINFO_GLYPH_OFFSET, "i32"));
        }
        if (glyphinfo) {
          const flags = this.mod.getValue(glyphinfo + GLYPHINFO_FLAGS_OFFSET, "i32");
          const mark = flags & MG_PET ? "pet" : flags & MG_OBJPILE ? "pile" : undefined;
          this.renderer.drawGlyph(x, y, this.mod.getValue(glyphinfo + GLYPHINFO_GLYPH_OFFSET, "i32"), mark);
        }
        return;
      }

      case "shim_putstr": {
        const window = args[0] as number;
        const str = (args[2] as string) ?? "";
        if (this.windowType.get(window) === NHW.TEXT) {
          if (!this.textBuffers.has(window)) this.textBuffers.set(window, []);
          this.textBuffers.get(window)!.push(str);
        } else if (str) {
          this.log(str);
        }
        return;
      }
      case "shim_raw_print":
      case "shim_raw_print_bold": {
        const str = args[0] as string;
        if (str) this.log(str);
        return;
      }
      case "shim_putmsghistory": {
        const str = args[0] as string;
        if (str) this.log(str);
        return;
      }

      case "shim_nhgetch":
        return this.input.nextKey();

      case "shim_nh_poskey": {
        // Returns a keystroke, or 0 for a map click (with *x,*y,*mod filled).
        // The moveloop's command prompt waits here — while suspended, menubar/
        // toolbar dispatch is safe (Qt's ok_for_command analog).
        const [xPtr, yPtr, modPtr] = args as [number, number, number];
        this.awaitingCommand = true;
        const ev = await this.input.next();
        this.awaitingCommand = false;
        if (ev.kind === "mouse") {
          if (xPtr) this.mod.setValue(xPtr, ev.x, "i16");
          if (yPtr) this.mod.setValue(yPtr, ev.y, "i16");
          if (modPtr) this.mod.setValue(modPtr, ev.button, "i32");
          return 0;
        }
        if (xPtr) this.mod.setValue(xPtr, 0, "i16");
        if (yPtr) this.mod.setValue(yPtr, 0, "i16");
        if (modPtr) this.mod.setValue(modPtr, 0, "i32");
        return ev.code;
      }

      case "shim_yn_function": {
        const query = args[0] as string;
        const resp = args[1] as string;
        const def = args[2] as number;
        this.log(query + (resp ? ` [${resp}]` : "") + (def ? ` (${String.fromCharCode(def)})` : ""));
        // Wait for a valid response key (interactive — never auto-answer).
        for (;;) {
          const key = await this.input.nextKey();
          if (!resp) return key; // no constraint: any key
          if (key === 13 || key === 10) return def || resp.charCodeAt(0); // Enter → default
          if (key === 27) return resp.includes("q") ? "q".charCodeAt(0) : def || 27; // Esc
          if (resp.includes(String.fromCharCode(key))) return key;
          // otherwise ignore and keep waiting
        }
      }

      case "shim_getlin": {
        // query (string), bufp (pointer we must fill with the typed line).
        const bufp = args[1] as number;
        const line = await this.promptCtl.getLine(args[0] as string);
        if (bufp) this.mod.stringToUTF8(line, bufp, 256);
        return;
      }

      case "shim_player_selection_or_tty":
        return true; // let the generic setup honor our pre-selected character

      case "shim_start_menu": {
        const mbehavior = args[1] as number;
        this.menus.set(args[0] as number, {
          items: [],
          prompt: "",
          permInvent: mbehavior === MENU_BEHAVE_PERMINV,
        });
        return;
      }
      case "shim_add_menu": {
        const menu = this.menus.get(args[0] as number);
        if (menu) {
          // winshim.c: (window, glyphinfo, identifier, ch, gch, attr, clr, str, itemflags)
          const glyphinfo = args[1] as number;
          const identifier = args[2] as number; // fmt 'i' → low 32 bits of anything
          const glyph = glyphinfo ? this.mod.getValue(glyphinfo + GLYPHINFO_GLYPH_OFFSET, "i32") : -1;
          const itemflags = (args[8] as number) ?? 0;
          menu.items.push({
            identifier,
            accel: args[3] as number,
            groupAccel: (args[4] as number) ?? 0,
            glyph,
            text: (args[7] as string) ?? "",
            attr: (args[5] as number) ?? 0,
            color: (args[6] as number) ?? 8, // NO_COLOR
            selectable: identifier !== 0, // zero identifier = header/text line
            preselected: (itemflags & 0x1) !== 0, // MENU_ITEMFLAGS_SELECTED
          });
        }
        return;
      }
      case "shim_end_menu": {
        const menu = this.menus.get(args[0] as number);
        if (menu) menu.prompt = (args[1] as string) ?? "";
        return;
      }
      case "shim_select_menu": {
        const window = args[0] as number;
        const how = args[1] as number;
        const menuListPtr = args[2] as number;
        const menu = this.menus.get(window) ?? { items: [], prompt: "", permInvent: false };
        this.menus.delete(window);

        // perm_invent: signaled by MENU_BEHAVE_PERMINV on start_menu (WIN_INVEN
        // is a perfectly ordinary NHW_MENU otherwise) — a passive, always-visible
        // panel, never a blocking modal. The core repopulates it on every
        // inventory change with want_reply=FALSE and expects no selection back.
        if (menu.permInvent) {
          this.permInvent.render(menu.items);
          this.paperdoll.render(menu.items);
          if (menuListPtr) this.mod.setValue(menuListPtr, 0, "i32");
          return 0;
        }

        const picks = await this.menuCtl.show(menu.prompt, menu.items, how);

        if (picks.length === 0) {
          if (menuListPtr) this.mod.setValue(menuListPtr, 0, "i32");
          return 0;
        }
        // Allocate a menu_item[] the core will free: { anything(8), long count(4), uint flags(4) }.
        const ITEM_SIZE = 16;
        const arr = this.mod._malloc(picks.length * ITEM_SIZE);
        picks.forEach((p, i) => {
          const base = arr + i * ITEM_SIZE;
          this.mod.setValue(base, p.identifier, "i32"); // anything low word (a_int / ptr)
          this.mod.setValue(base + 4, 0, "i32"); // anything high word
          this.mod.setValue(base + 8, p.count, "i32"); // long count
          this.mod.setValue(base + 12, 0, "i32"); // itemflags
        });
        if (menuListPtr) this.mod.setValue(menuListPtr, arr, "i32");
        return picks.length;
      }
      case "shim_message_menu":
        return args[0] as number; // return the offered letter unchanged

      case "shim_getmsghistory":
      case "shim_get_color_string":
        return "";
      case "shim_doprev_message":
        return -1;
      case "shim_get_ext_cmd":
        return this.extCmdCtl.choose();
      case "set_shim_font_name":
        return 0;

      case "shim_curs": {
        // Cursor placement on the map window: draw the HP-colored cursor
        // rectangle there (qt_map.cpp) and keep the viewport following it.
        if (this.windowType.get(args[0] as number) === NHW.MAP) {
          this.renderer.setCursor(args[1] as number, args[2] as number);
          this.renderer.centerOn(args[1] as number, args[2] as number);
        }
        return;
      }
      case "shim_cliparound":
        this.renderer.centerOn(args[0] as number, args[1] as number);
        return;

      case "shim_status_update": {
        // args (fmt "vipiiip"): fldidx, value ptr, chg, percent, color, colormasks
        const idx = args[0] as number;
        const ptr = args[1] as number;
        if (idx === BL_FLUSH) this.status.render();
        else if (idx === BL_RESET) {
          /* redisplay handled on next FLUSH */
        } else if (idx === BL_CONDITION) {
          if (ptr) this.status.setCondition(this.mod.getValue(ptr, "i32"));
        } else if (ptr) {
          const val = this.mod.UTF8ToString(ptr);
          this.status.update(idx, val);
          // Keep the map cursor's HP tint current (BL_HP=18 / BL_HPMAX=19).
          if (idx === 18 || idx === 19) {
            const hp = Number(this.status.value(18));
            const hpmax = Number(this.status.value(19));
            if (Number.isFinite(hp) && Number.isFinite(hpmax)) {
              this.renderer.setCursorHealth(hp, hpmax);
            }
          }
        }
        return;
      }

      case "shim_exit_nhwindows":
        // Game is ending (save / quit / death) — flush the save/record to IndexedDB.
        await this.storage.save();
        return;

      // Known-but-ignored for now.
      case "shim_init_nhwindows":
      case "shim_askname":
      case "shim_get_nh_event":
      case "shim_suspend_nhwindows":
      case "shim_resume_nhwindows":
      case "shim_display_file":
      case "shim_mark_synch":
      case "shim_wait_synch":
      case "shim_update_positionbar":
      case "shim_nhbell":
      case "shim_number_pad":
      case "shim_delay_output":
      case "shim_change_color":
      case "shim_change_background":
      case "shim_preference_update":
      case "shim_status_init":
      case "shim_update_inventory":
        return;

      default:
        if (!this.seenProcs.has(name)) {
          this.seenProcs.add(name);
          console.warn("[nethack] unhandled proc:", name, args);
        }
        return;
    }
  };

  private log(line: string): void {
    const el = document.createElement("div");
    el.textContent = line;
    this.dom.messages.appendChild(el);
    this.dom.messages.scrollTop = this.dom.messages.scrollHeight;
  }

  /** Append a --More-- chip to the message log and wait for space/Enter/Esc. */
  private async more(): Promise<void> {
    const chip = document.createElement("div");
    chip.className = "more-chip";
    chip.textContent = "--More--";
    this.dom.messages.appendChild(chip);
    this.dom.messages.scrollTop = this.dom.messages.scrollHeight;
    for (;;) {
      const key = await this.input.nextKey();
      if (key === 32 || key === 13 || key === 10 || key === 27) break;
    }
    chip.remove();
  }
}
