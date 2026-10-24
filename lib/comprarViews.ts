// Comprar tiene 3 pantallas, cada una con su link (puro: lo usan ComprarNav y los tests).
import { MY_PURCHASES_TITLE } from './purchases';

export type ComprarView = 'feed' | 'link' | 'compras';
export const COMPRAR_VIEWS = [
  { key: 'feed', label: 'Feed', href: '/comprar', icon: 'storefront-outline' },
  { key: 'link', label: 'Pagar con link', href: '/comprar/link', icon: 'link-outline' },
  { key: 'compras', label: MY_PURCHASES_TITLE, href: '/comprar/compras', icon: 'bag-check-outline' },
] as const satisfies readonly { key: ComprarView; label: string; href: string; icon: string }[];
