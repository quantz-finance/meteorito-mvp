// Reglas puras del alto estable (sin react-native: testeables en node). Ver lib/viewport.ts.
export interface Size { width: number; height: number }

/** ¿Hay un campo de texto enfocado (teclado abierto en móvil)? */
export function editableFocused(doc: Pick<Document, 'activeElement'> | undefined = typeof document !== 'undefined' ? document : undefined): boolean {
  const el = doc?.activeElement as HTMLElement | null | undefined;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || el.isContentEditable) return true;
  return tag === 'INPUT' && !/^(button|checkbox|radio|range|file|submit|reset|color|image|hidden)$/i.test((el as HTMLInputElement).type ?? '');
}

/** Regla pura (testeable): siguiente tamaño estable dado el medido. */
export function nextStable(prev: Size | null, measured: Size, keyboard: boolean): Size {
  if (!prev || Math.abs(prev.width - measured.width) > 1) return measured; // primera vez o giro
  if (measured.height >= prev.height) return measured.height === prev.height ? prev : measured;
  return keyboard ? prev : measured; // con teclado: nunca encoger
}

