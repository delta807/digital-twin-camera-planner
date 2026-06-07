/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Minimal in-memory localStorage for unit tests. Avoids depending on jsdom (and sidesteps Node's
// experimental `localStorage` global, which is undefined without --localstorage-file). profiles.ts
// only uses getItem/setItem/removeItem/clear, so this faithful Storage shim is enough.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
}

globalThis.localStorage = new MemoryStorage();
