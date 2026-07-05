/** Minimal typing for the emscripten-generated `nethack.js` module. */
export interface NetHackModule {
  arguments?: string[];
  noInitialRun?: boolean;
  locateFile?: (path: string, prefix: string) => string;
  preRun?: Array<() => void>;
  onRuntimeInitialized?: () => void;
  print?: (s: string) => void;
  printErr?: (s: string) => void;

  callMain: (args: string[]) => number;

  ENV: Record<string, string>;
  FS: any;
  ccall: (name: string, ret: string | null, argTypes: string[], args: unknown[]) => unknown;
  getValue: (ptr: number, type: string) => number;
  setValue: (ptr: number, value: number, type: string) => void;
  UTF8ToString: (ptr: number, maxBytesToRead?: number) => string;
  stringToUTF8: (str: string, outPtr: number, maxBytesToWrite: number) => void;
}

export type NetHackFactory = (moduleArg: Partial<NetHackModule>) => Promise<NetHackModule>;
