const records = new Map<string, string>();
export const engineStorage = {
  getItem(key: string): string | null {
    return typeof window === "undefined"
      ? globalThis.localStorage.getItem(key)
      : key.startsWith("syndik_prod_")
        ? (records.get(key) ?? null)
        : window.localStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (typeof window === "undefined")
      globalThis.localStorage.setItem(key, value);
    else if (key.startsWith("syndik_prod_")) records.set(key, value);
    else window.localStorage.setItem(key, value);
  },
  removeItem(key: string) {
    if (typeof window === "undefined") globalThis.localStorage.removeItem(key);
    else {
      records.delete(key);
      window.localStorage.removeItem(key);
    }
  },
};
export function clearBusinessCache() {
  records.clear();
}

