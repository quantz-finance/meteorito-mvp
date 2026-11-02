// Quita metadatos (EXIF con GPS, XMP, IPTC, comentarios) de JPEG/PNG/WebP sin recodificar la imagen (JS puro, sin
// dependencias nativas: corre en el runtime CJS de Vercel). Los píxeles no cambian.
//  - JPEG: fuera APP1 (EXIF/XMP), APP13 (IPTC/Photoshop), COM y APP3-APP12/APP15; se quedan APP0 (JFIF), APP2 solo si es
//    perfil de color ICC y APP14 (Adobe: necesario para decodificar bien). Si la foto traía Orientation != 1 se agrega
//    un EXIF mínimo con SOLO esa etiqueta, para que no aparezca girada.
//  - PNG: fuera tEXt, zTXt, iTXt, eXIf y tIME.
//  - WebP: fuera los chunks EXIF y "XMP " (y sus banderas en VP8X).
// Formato desconocido o archivo dañado: se devuelve tal cual (changed:false) para no romper el flujo.
export type StripResult = { bytes: Uint8Array; changed: boolean; format: 'jpeg' | 'png' | 'webp' | 'unknown'; removed: string[] };

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

export function detectImage(b: Uint8Array): StripResult['format'] {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length > 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  return 'unknown';
}

/** Orientation (0x0112) del bloque EXIF de un APP1 ("Exif\0\0" + TIFF), o null. */
export function exifOrientation(seg: Uint8Array): number | null {
  if (seg.length < 14 || ascii(seg, 0, 6) !== 'Exif\0\0') return null;
  const t = seg.subarray(6);
  const le = ascii(t, 0, 2) === 'II'; if (!le && ascii(t, 0, 2) !== 'MM') return null;
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16)) + t[o + 3] * 2 ** 24 : t[o] * 2 ** 24 + ((t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]));
  const ifd = u32(4); if (ifd + 2 > t.length) return null;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12; if (e + 12 > t.length) return null;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : null; }
  }
  return null;
}
/** ¿El APP1 es un EXIF con UNA sola etiqueta (Orientation) y sin más IFDs? Es el que dejamos nosotros. */
function onlyOrientation(seg: Uint8Array): boolean {
  if (exifOrientation(seg) == null || seg.length > 64) return false;
  const t = seg.subarray(6); const le = t[0] === 0x49;
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const ifd = le ? t[4] | (t[5] << 8) : (t[6] << 8) | t[7];
  if (u16(ifd) !== 1 || ifd + 18 > t.length) return false;
  return t[ifd + 14] === 0 && t[ifd + 15] === 0 && t[ifd + 16] === 0 && t[ifd + 17] === 0;
}
/** APP1 EXIF mínimo (big-endian) con solo Orientation. */
function orientationApp1(o: number): Uint8Array {
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
  const len = body.length + 2;
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 0xff, ...body]);
}

function stripJpeg(b: Uint8Array): StripResult {
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  const removed: string[] = [];
  let orientation: number | null = null;
  let p = 2;
  while (p < b.length) {
    if (b[p] !== 0xff) return { bytes: b, changed: false, format: 'jpeg', removed: [] }; // dañado: no tocar
    let m = b[p + 1];
    while (m === 0xff && p + 2 < b.length) { p++; m = b[p + 1]; } // bytes de relleno
    if (m === 0xd9) { keep.push(b.subarray(p, p + 2)); p += 2; break; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { keep.push(b.subarray(p, p + 2)); p += 2; continue; }
    if (p + 4 > b.length) return { bytes: b, changed: false, format: 'jpeg', removed: [] };
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2 || p + 2 + len > b.length) return { bytes: b, changed: false, format: 'jpeg', removed: [] };
    const seg = b.subarray(p, p + 2 + len), data = b.subarray(p + 4, p + 2 + len);
    if (m === 0xda) { keep.push(b.subarray(p)); p = b.length; break; } // SOS: el resto (datos de imagen) va tal cual
    let drop = false, name = '';
    if (m === 0xe1 && onlyOrientation(data)) { /* EXIF mínimo (solo Orientation): se queda */ }
    else if (m === 0xe1) { drop = true; if (ascii(data, 0, 6) === 'Exif\0\0') { name = 'exif'; orientation ??= exifOrientation(data); } else name = 'xmp/app1'; }
    else if (m === 0xed) { drop = true; name = 'iptc'; }
    else if (m === 0xfe) { drop = true; name = 'comment'; }
    else if (m === 0xe2) { if (ascii(data, 0, 12) !== 'ICC_PROFILE\0') { drop = true; name = 'app2'; } }
    else if ((m >= 0xe3 && m <= 0xec) || m === 0xef) { drop = true; name = `app${m - 0xe0}`; }
    if (drop) removed.push(name); else keep.push(seg);
    p += 2 + len;
  }
  if (p < b.length) keep.push(b.subarray(p)); // bytes después de EOI
  if (!removed.length) return { bytes: b, changed: false, format: 'jpeg', removed };
  if (orientation && orientation !== 1) {
    // Después de SOI y APP0 (si lo hay).
    const at = keep.length > 1 && keep[1][1] === 0xe0 ? 2 : 1;
    keep.splice(at, 0, orientationApp1(orientation));
  }
  return { bytes: concat(keep), changed: true, format: 'jpeg', removed };
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
function stripPng(b: Uint8Array): StripResult {
  const keep: Uint8Array[] = [b.subarray(0, 8)]; const removed: string[] = [];
  let p = 8;
  while (p + 12 <= b.length) {
    const len = ((b[p] << 24) >>> 0) + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
    const type = ascii(b, p + 4, 4); const end = p + 12 + len;
    if (end > b.length) return { bytes: b, changed: false, format: 'png', removed: [] };
    if (PNG_DROP.has(type)) removed.push(type); else keep.push(b.subarray(p, end));
    p = end;
    if (type === 'IEND') break;
  }
  if (p < b.length) keep.push(b.subarray(p));
  return removed.length ? { bytes: concat(keep), changed: true, format: 'png', removed } : { bytes: b, changed: false, format: 'png', removed };
}

function stripWebp(b: Uint8Array): StripResult {
  const keep: Uint8Array[] = []; const removed: string[] = [];
  let p = 12;
  while (p + 8 <= b.length) {
    const fourcc = ascii(b, p, 4);
    const size = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] * 2 ** 24);
    const end = p + 8 + size + (size & 1);
    if (p + 8 + size > b.length) return { bytes: b, changed: false, format: 'webp', removed: [] };
    if (fourcc === 'EXIF' || fourcc === 'XMP ') removed.push(fourcc.trim().toLowerCase());
    else keep.push(b.subarray(p, Math.min(end, b.length)));
    p = end;
  }
  if (!removed.length) return { bytes: b, changed: false, format: 'webp', removed };
  const out = concat([b.subarray(0, 12), ...keep]);
  const riff = out.length - 8;
  out[4] = riff & 0xff; out[5] = (riff >> 8) & 0xff; out[6] = (riff >> 16) & 0xff; out[7] = (riff >>> 24) & 0xff;
  if (ascii(out, 12, 4) === 'VP8X') out[20] &= ~(0x08 | 0x04); // sin banderas EXIF/XMP
  return { bytes: out, changed: true, format: 'webp', removed };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

export function stripImageMetadata(input: Uint8Array): StripResult {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const f = detectImage(b);
  if (f === 'jpeg') return stripJpeg(b);
  if (f === 'png') return stripPng(b);
  if (f === 'webp') return stripWebp(b);
  return { bytes: b, changed: false, format: 'unknown', removed: [] };
}
