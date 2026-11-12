import { useEffect, useSyncExternalStore } from "react";

/**
 * Which shell the logged-in app shows: the ship (the 3D game, the default) or the classic view.
 *
 * The classic view is a hidden fallback. It is entered only when the game cannot run (a crash, no
 * WebGL, no first frame) or by the secret key chord, and it is remembered in localStorage so the
 * next launch opens classic too, until the owner chooses "Return to the ship" there.
 * Plain localStorage and no app imports, so the router, the layout and the game can all use it.
 */

const KEY = "vt_classic_mode";
const REASON_KEY = "vt_classic_reason";
/** Ctrl+Shift+F12 toggles the classic view. */
export const CHORD = "Ctrl+Shift+F12";

let memory: { on: boolean; reason: string | null } | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (memory) return memory.on;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const isClassic = (): boolean => read();

/** Why the app fell back to the classic view (null when the owner chose it, or in the ship). */
export function classicReason(): string | null {
  if (memory) return memory.reason;
  try {
    return localStorage.getItem(REASON_KEY);
  } catch {
    return null;
  }
}

export function setClassic(on: boolean, reason: string | null = null) {
  const was = read();
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
    if (on && reason) localStorage.setItem(REASON_KEY, reason);
    else localStorage.removeItem(REASON_KEY);
    memory = null;
  } catch {
    // storage unavailable: the choice holds for this session only
    memory = { on, reason: on ? reason : null };
  }
  if (was !== on) for (const l of [...listeners]) l();
}

/** The game cannot run: switch to the classic view and remember why. Safe to call more than once. */
export function fallBackToClassic(reason: string) {
  if (read()) return;
  console.warn(`[shell] the ship cannot run (${reason}): opening the classic view`);
  setClassic(true, reason);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // another window of the app changed it
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export const useClassicMode = (): boolean => useSyncExternalStore(subscribe, read, read);

/** The secret escape hatch: Ctrl+Shift+F12 toggles between the ship and the classic view. */
export function useClassicChord() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "F12" || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey || e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      setClassic(!read(), null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

const WATCHDOG_KEY = "vt_game_watchdog_ms";
/** How long the game may take to draw its first frame (visible time only) before the fallback. */
export function watchdogMs(): number {
  try {
    const v = Number(localStorage.getItem(WATCHDOG_KEY));
    if (Number.isFinite(v) && v >= 500) return v;
  } catch {
    /* default */
  }
  return 25000;
}
