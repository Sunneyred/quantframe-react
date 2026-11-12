/** A tiny typed event emitter shared by the engine and the React layer. */
export class Emitter<T extends object> {
  private map = new Map<keyof T, Set<(v: never) => void>>();

  on<K extends keyof T>(key: K, fn: (value: T[K]) => void): () => void {
    let set = this.map.get(key);
    if (!set) this.map.set(key, (set = new Set()));
    set.add(fn as (v: never) => void);
    return () => set!.delete(fn as (v: never) => void);
  }

  emit<K extends keyof T>(key: K, value: T[K]) {
    const set = this.map.get(key);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as (v: T[K]) => void)(value);
      } catch (e) {
        console.error("[game] listener failed", e);
      }
    }
  }

  clear() {
    this.map.clear();
  }
}

export function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
