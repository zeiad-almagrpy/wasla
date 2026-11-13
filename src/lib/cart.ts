import { useSyncExternalStore } from 'react';

/** Cart kept in memory + localStorage so a refresh or a dropped connection never empties it. Holds ids and quantities only; prices always come from the server. */
export type CartState = { storeId: string | null; items: Record<string, number> };
const KEY = 'wesla.cart.v1';
const EMPTY: CartState = { storeId: null, items: {} };

const load = (): CartState => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as CartState | null;
    if (!raw || typeof raw.items !== 'object') return EMPTY;
    const items: Record<string, number> = {};
    for (const [id, q] of Object.entries(raw.items)) if (typeof q === 'number' && q > 0 && q <= 50) items[id] = Math.floor(q);
    return Object.keys(items).length ? { storeId: typeof raw.storeId === 'string' ? raw.storeId : null, items } : EMPTY;
  } catch { return EMPTY; }
};
let state: CartState = load();
const listeners = new Set<() => void>();
const commit = (next: CartState) => {
  state = Object.keys(next.items).length ? next : EMPTY;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked: cart still works in memory */ }
  listeners.forEach((l) => l());
};

export const cart = {
  get: () => state,
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  add(storeId: string, productId: string) {
    if (state.storeId && state.storeId !== storeId) return false;
    const q = state.items[productId] || 0;
    if (q >= 50) return false;
    commit({ storeId, items: { ...state.items, [productId]: q + 1 } });
    return true;
  },
  set(productId: string, qty: number) {
    const items = { ...state.items };
    if (qty <= 0) delete items[productId]; else items[productId] = Math.min(50, Math.floor(qty));
    commit({ storeId: state.storeId, items });
  },
  remove(productId: string) { cart.set(productId, 0); },
  clear() { commit(EMPTY); },
};
export const useCart = () => useSyncExternalStore(cart.subscribe, cart.get, cart.get);
export const cartCount = (c: CartState) => Object.values(c.items).reduce((n, q) => n + q, 0);
