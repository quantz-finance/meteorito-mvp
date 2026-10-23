// Diagnóstico de fallas al subir fotos (sin datos personales). Módulo puro: se prueba en Node (scripts/ci/t43).
// Etapas: compress (decodificar/comprimir en el dispositivo: HEIC, memoria), sign (/api/photos/upload-url: sesión,
// tamaño, tipo), storage (subida a Supabase Storage por URL firmada: red, límite del bucket).
export type PhotoStage = 'compress' | 'sign' | 'storage';
export const tagPhotoError = (stage: PhotoStage, e: unknown) => {
  const err = e instanceof Error ? e : new Error(String(e));
  if (!(err as any).photoStage) (err as any).photoStage = stage;
  return err;
};
/** Propiedades para el evento photo_upload_failed: etapa, código y estado HTTP. Nunca el mensaje crudo. */
export function photoFailureProps(e: unknown): { stage: string; code: string; http_status: number | null; mime: string | null } {
  const x: any = e ?? {};
  const code = String(x.code ?? (x.name && x.name !== 'Error' ? x.name : 'unknown')).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40);
  const status = Number(x.status ?? x.statusCode);
  return { stage: x.photoStage ?? 'unknown', code, http_status: Number.isFinite(status) && status > 0 ? status : null, mime: typeof x.photoMime === 'string' ? x.photoMime.slice(0, 30) : null };
}
