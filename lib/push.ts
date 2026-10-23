// Web Push (VAPID). En iPhone solo funciona con la app instalada en la pantalla de inicio (iOS 16.4+).
// El permiso se pide SOLO con un botón propio (tarjeta), nunca al abrir la app.
import { api, guestApi } from './api';
import { DEMO_ENABLED } from './demo';
import type { MeteoritoAuth } from './types';

export type PushRole = 'seller' | 'buyer';
export type PushStatus = 'unsupported' | 'ios_install' | 'denied' | 'enabled' | 'ask';
const KEY = (r: PushRole) => `meteorito:push:${r}`;
const DISMISS = (r: PushRole) => `meteorito:push:dismiss:${r}`;
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } } };

export function isIos(): boolean { return typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)); }
export function isStandalone(): boolean {
  return typeof window !== 'undefined' && ((navigator as any).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches);
}
export function pushStatus(role: PushRole): PushStatus {
  if (typeof window === 'undefined') return 'unsupported';
  if (DEMO_ENABLED) return ls.get(KEY(role)) ? 'enabled' : 'ask';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIos() && !isStandalone()) return 'ios_install';
  if (!supported) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && ls.get(KEY(role))) return 'enabled';
  return 'ask';
}
export const isDismissed = (role: PushRole) => !!ls.get(DISMISS(role));
export const dismissPush = (role: PushRole) => ls.set(DISMISS(role), String(Date.now()));

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const unavailable = () => Object.assign(new Error('Las notificaciones todavía no están disponibles.'), { code: 'push_unavailable' });

/** Llamar DIRECTO desde el toque del botón (iOS exige el gesto para pedir permiso). */
export async function enablePush(auth: Pick<MeteoritoAuth, 'getAuthToken'> & Partial<MeteoritoAuth>, role: PushRole): Promise<void> {
  if (DEMO_ENABLED) { ls.set(KEY(role), '1'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw Object.assign(new Error(perm === 'denied' ? 'Bloqueaste las notificaciones. Actívalas en los ajustes del navegador.' : 'No activaste las notificaciones.'), { code: 'push_denied' });
  const r = await fetch('/api/store?push=key').catch(() => null);
  const key = r?.ok ? ((await r.json().catch(() => ({}))) as any).key : null;
  if (!key) throw unavailable();
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  const body = { action: 'push_subscribe', subscription: sub.toJSON() };
  try {
    if (role === 'seller') await api(auth as MeteoritoAuth, '/api/store', body); else await guestApi(auth, '/api/store', body);
  } catch (e: any) { if (e?.status === 503 || e?.code === 'push_unavailable') throw unavailable(); throw e; }
  ls.set(KEY(role), '1');
}
