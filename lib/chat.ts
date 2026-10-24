// Chat comprador-vendedor en la app: cliente de /api/store (acciones chat_*). Ver api/_lib/chat.ts y docs/chat.md.
// Vendedor: sesión Cavos (api(), con renovación de sesión). Comprador: llave de invitado de este dispositivo (guestApi()).
// Tiempo real: polling inteligente (lib/chatText.chatPollDelay): 2,5 s con el chat abierto y la pestaña visible, más
// lento sin actividad, detenido en segundo plano. Las insignias de no leídos se piden cada 45 s con la pantalla visible.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { api, guestApi } from './api';
import { DEMO_ENABLED } from './demo';
import { hasGuestKey } from './guest';
import type { MeteoritoAuth } from './types';
import { CHAT_BADGE_MS, type ChatRole } from '../api/_lib/chatText';
export { CHAT_MAX, chatPollDelay, sharesContact, type ChatRole } from '../api/_lib/chatText';

type Auth = Pick<MeteoritoAuth, 'getAuthToken'> & Partial<MeteoritoAuth>;
export interface ChatMsg { id: number; sender: ChatRole; body: string; client_id: string | null; created_at: string; pending?: 'sending' | 'failed' }
export interface ChatConversation {
  token: string; kind: 'store' | 'order'; subject: string | null; item_photo: string | null;
  item: { slug: string; price_crc: number | null } | null; order: { slug: string; status: string; price_crc: number | null } | null; paid: boolean;
  other: { name: string; store_slug: string | null; avatar_url: string | null };
}
export interface ChatRead { role: ChatRole; blocked: boolean; other_read_at: string | null; other_typing: boolean; has_more: boolean; messages: ChatMsg[]; conversation?: ChatConversation }
export interface ChatListItem { token: string; role: ChatRole; kind: 'store' | 'order'; order_slug: string | null; subject: string | null; photo: string | null; name: string; last_preview: string; last_sender: ChatRole | null; last_message_at: string; unread: boolean; blocked: boolean }

const call = <T,>(auth: Auth, as: ChatRole, body: Record<string, unknown>) =>
  (as === 'seller' ? api<T>(auth as MeteoritoAuth, '/api/store', body) : guestApi<T>(auth, '/api/store', body));

/** ¿Está el chat (migración 025)? Una vez por sesión de la app; sin él la app no muestra los botones de mensaje. */
let avail: Promise<boolean> | null = null;
export function chatAvailable(): Promise<boolean> {
  if (DEMO_ENABLED) return Promise.resolve(true);
  return (avail ??= fetch('/api/store?chat=status').then((r) => (r.ok ? r.json() : { available: false })).then((j: any) => j?.available === true).catch(() => { avail = null; return false; }));
}
export function useChatAvailable(): boolean {
  const [v, setV] = useState(DEMO_ENABLED);
  useEffect(() => { let on = true; chatAvailable().then((x) => on && setV(x)); return () => { on = false; }; }, []);
  return v;
}

export const openChat = (auth: Auth, as: ChatRole, target: { store_slug: string; item_slug?: string } | { order_slug: string }) =>
  call<{ token: string; role: ChatRole }>(auth, as, { action: 'chat_open', ...target });
export const readChat = (auth: Auth, as: ChatRole, token: string, o: { after?: number; before?: number; typing?: boolean; full?: boolean } = {}) =>
  call<ChatRead>(auth, as, { action: 'chat_get', token, ...o });
export const sendChat = (auth: Auth, as: ChatRole, token: string, body: string, client_id: string) =>
  call<{ message: ChatMsg }>(auth, as, { action: 'chat_send', token, body, client_id });
export const listChats = (auth: Auth, as: ChatRole) => call<{ unread: number; conversations: ChatListItem[] }>(auth, as, { action: 'chat_list', as });
export const blockChat = (auth: Auth, token: string, blocked: boolean) => call<{ blocked: boolean }>(auth, 'seller', { action: 'chat_block', token, blocked });
export const reportChat = (auth: Auth, as: ChatRole, token: string, reason: string, detail?: string) =>
  call<{ reported: boolean }>(auth, as, { action: 'chat_report', token, reason, ...(detail?.trim() ? { detail: detail.trim() } : {}) });

/** id del mensaje en el cliente (envío optimista: el reintento no duplica). */
export const newClientId = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join(''); };
/** Link del chat: el token va en el query (la analítica descarta el query; nunca sale en $current_url). */
export const chatHref = (token: string, as: ChatRole) => `/chat?c=${token}&r=${as === 'seller' ? 's' : 'b'}` as const;

/* ---------- Insignia de no leídos (compartida entre pantallas) ---------- */
const unread: Record<ChatRole, number> = { buyer: 0, seller: 0 };
const total: Record<ChatRole, number> = { buyer: 0, seller: 0 };
/** Conversaciones con mensajes de este lado (último conteo; 0 hasta que se pida). */
export const chatTotal = (as: ChatRole) => total[as];
let ver = 0;
const subs = new Set<() => void>();
const emit = () => { ver++; subs.forEach((f) => f()); };
const inFlight: Partial<Record<ChatRole, Promise<void>>> = {};
/** Vuelve a pedir cuántas conversaciones sin leer hay. Nunca lanza. */
export function refreshUnread(auth: Auth, as: ChatRole): Promise<void> {
  if (as === 'buyer' && !DEMO_ENABLED && !hasGuestKey() && !auth.getAuthToken()) return Promise.resolve(); // visitante nuevo: nada que pedir
  if (as === 'seller' && !auth.getAuthToken()) return Promise.resolve();
  return (inFlight[as] ??= (async () => {
    try {
      if (!(await chatAvailable())) return;
      const r = await call<{ unread: number; total?: number }>(auth, as, { action: 'chat_list', as, summary: true });
      const n = Math.max(0, Number(r?.unread) || 0), t = Math.max(n, Number(r?.total) || 0);
      if (n !== unread[as] || t !== total[as]) { unread[as] = n; total[as] = t; emit(); }
    } catch { /* sin red / sin sesión: se queda el último número */ } finally { delete inFlight[as]; }
  })());
}
export const setUnread = (as: ChatRole, n: number, t?: number) => {
  const tt = t == null ? Math.max(total[as], n) : t;
  if (unread[as] !== n || total[as] !== tt) { unread[as] = n; total[as] = tt; emit(); }
};
/** Conversaciones sin leer de este lado; se refresca al enfocar la pantalla y cada 45 s si la pestaña está visible. */
export function useChatUnread(auth: Auth, as: ChatRole, enabled = true): number {
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => ver, () => ver);
  const token = auth.getAuthToken();
  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    void refreshUnread(auth, as);
    const visible = () => Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden;
    const id = setInterval(() => { if (visible()) void refreshUnread(auth, as); }, CHAT_BADGE_MS);
    const onVis = () => { if (visible()) void refreshUnread(auth, as); };
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis); };
  }, [as, enabled, token])); // eslint-disable-line react-hooks/exhaustive-deps
  return enabled ? unread[as] : 0;
}

/** Hora corta "14:05" y separadores de día "Hoy" / "Ayer" / "lun 20 oct". */
export function hhmm(iso: string): string { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso); const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400e3);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  const W = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'], M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${W[d.getDay()]} ${d.getDate()} ${M[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}
/** Hora para la bandeja: "14:05" hoy, "Ayer", o "20 oct". */
export function listTime(iso: string, now = new Date()): string {
  const l = dayLabel(iso, now); if (l === 'Hoy') return hhmm(iso); if (l === 'Ayer') return l;
  const d = new Date(iso); return `${d.getDate()} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getMonth()]}`;
}
/** Mensajes de la otra parte o propios unidos por id (el polling y el envío optimista no duplican). */
export function mergeMessages(cur: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  if (!incoming.length) return cur;
  const byClient = new Map(incoming.filter((m) => m.client_id).map((m) => [m.client_id!, m]));
  const ids = new Set(incoming.map((m) => m.id));
  const kept = cur.filter((m) => !(m.client_id && byClient.has(m.client_id)) && !(m.id > 0 && ids.has(m.id)));
  return [...kept, ...incoming].sort((a, b) => (a.pending && !b.pending ? 1 : !a.pending && b.pending ? -1 : a.pending && b.pending ? 0 : a.id - b.id));
}
