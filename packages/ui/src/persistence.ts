/**
 * Persistence for saves / bones / record / scores.
 *
 * The WASM build redirects all read-write files to /nethack-data (VAR_PLAYGROUND);
 * we mount that as IDBFS and sync it to IndexedDB. The interface is deliberately
 * storage-agnostic so the desktop (Tauri) build can drop in a real-FS backend.
 */
import type { NetHackModule } from "./emscripten";

export const PLAYGROUND = "/nethack-data";

export interface Storage {
  /** Populate the in-memory FS from durable storage (call before starting the game). */
  load(): Promise<void>;
  /** Flush the in-memory FS to durable storage (call after a save/quit/death). */
  save(): Promise<void>;
}

/** IDBFS-backed storage for the browser. */
export class IdbfsStorage implements Storage {
  constructor(private mod: NetHackModule) {}

  mount(): void {
    const { FS, IDBFS } = this.mod;
    mkdirp(FS, PLAYGROUND);
    FS.mount(IDBFS, {}, PLAYGROUND);
  }

  async load(): Promise<void> {
    await this.syncfs(true);
    const { FS } = this.mod;
    // The UNIX build writes saves to "<SAVEPREFIX>save/<uid><plname>" — ensure
    // that subdirectory exists after the initial sync (idempotent: harmless if
    // a prior session's sync already restored it).
    mkdirp(FS, `${PLAYGROUND}/save`);
    // "perm" (HLOCK, include/unixconf.h) is an empty lock file NetHack opens
    // O_RDWR *without* O_CREAT (via USE_FCNTL) — it must already exist. record
    // (the scoreboard) self-creates with O_CREAT, so it needs no such touch.
    const permPath = `${PLAYGROUND}/perm`;
    try {
      FS.stat(permPath);
    } catch {
      FS.writeFile(permPath, new Uint8Array(0));
    }
  }

  save(): Promise<void> {
    return this.syncfs(false);
  }

  private syncfs(populate: boolean): Promise<void> {
    return new Promise((resolve) => {
      this.mod.FS.syncfs(populate, (err: unknown) => {
        if (err) console.error("[persistence] syncfs failed:", err);
        resolve();
      });
    });
  }
}

function mkdirp(FS: NetHackModule["FS"], path: string): void {
  try {
    FS.mkdir(path);
  } catch {
    /* already exists */
  }
}
