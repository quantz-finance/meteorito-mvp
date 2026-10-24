// Fechas relativas cortas para el feed y el perfil ("hace 3 h", "miembro desde oct. 2026"). Puro, sin React.
const MESES = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.'];
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'ahora';
  const m = Math.floor(s / 60); if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24); if (d < 7) return `hace ${d} día${d === 1 ? '' : 's'}`;
  if (d < 30) return `hace ${Math.floor(d / 7)} sem`;
  const mo = Math.floor(d / 30); if (mo < 12) return `hace ${mo} mes${mo === 1 ? '' : 'es'}`;
  const y = Math.floor(d / 365); return `hace ${y} año${y === 1 ? '' : 's'}`;
}
export function memberSince(iso: string | null | undefined): string {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return '';
  return `${MESES[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}
