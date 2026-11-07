// Crear invitación: plazo incluye cabeceras y cuerpo; nunca reenvía una escritura a ciegas.
export const INVITE_TIMEOUT_MESSAGE = 'La solicitud tardó demasiado. Revisa Mis compras antes de volver a intentar; tu propuesta podría haberse creado.';
export async function invitePost(path: string, headers: Record<string, string>, body: unknown, timeoutMs = 20_000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(INVITE_TIMEOUT_MESSAGE), { code: 'invite_timeout', status: 408 }));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      const j: any = await r.json().catch(() => ({}));
      if (r.status >= 500 && !j?.error) return { r, j: { code: 'invite_unavailable', error: 'No pudimos completar la propuesta. Revisa Mis compras antes de volver a intentar.' } };
      return { r, j };
    })()]);
  } catch (e: any) {
    if (e?.code === 'invite_timeout') throw e;
    throw Object.assign(new Error('No pudimos enviar tu propuesta. Revisa tu conexión y vuelve a intentar.'), { code: 'invite_network', cause: e });
  } finally { clearTimeout(timer); }
}
