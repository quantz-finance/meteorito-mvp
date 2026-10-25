// Buscador de Comprar en un modalcito (puro + hook): la lupa (ComprarNav) abre la hoja y el feed (components/Feed.tsx)
// lee el texto. Estado del módulo: la búsqueda sigue activa al cambiar de pantalla dentro de Comprar (punto en la lupa).
import { useSyncExternalStore } from 'react';

const MAX = 60;
export const SEARCH_COPY = {
  open: 'Buscar',
  title: 'Buscar productos',
  hint: 'Escribe lo que buscas: se aplica al filtro y a la vista que tienes.',
  submit: 'Ver resultados',
} as const;

type State = { open: boolean; text: string; active: boolean };
let state: State = { open: false, text: '', active: false };
const subs = new Set<() => void>();
const set = (next: Partial<State>) => {
  const text = next.text ?? state.text;
  state = { open: next.open ?? state.open, text, active: text.trim().length > 0 };
  subs.forEach((f) => f());
};

export const getFeedSearch = () => state;
export function subscribeFeedSearch(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export const openSearch = () => set({ open: true });
export const closeSearch = () => set({ open: false });
export const setSearchText = (text: string) => set({ text: String(text).slice(0, MAX) });
export const clearSearch = () => set({ text: '' });
export function useFeedSearch() { return useSyncExternalStore(subscribeFeedSearch, getFeedSearch, getFeedSearch); }
