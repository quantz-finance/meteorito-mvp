# PII en reposo (fases A–C)

Teléfono y correo se cifran en el servidor (`api/_lib/pii.ts`, AES-256-GCM). El cliente no ve la llave ni el módulo.
Esta entrega **no** borra el texto en claro (eso es la migración 052, otro PR) y **no** cifra IBAN, SINPE, titular,
`display_name` ni `buyer_name`. `orders.seller_email` se deja de escribir; el backfill lo pone en null. La columna se elimina en el PR 2.

| Dato | Columna en claro (sigue) | Columna cifrada |
|---|---|---|
| WhatsApp / teléfono del comprador | `buyer_contacts.phone_e164` | `phone_e164_enc` |
| Correo del comprador | `buyer_contacts.email` | `email_enc` |
| WhatsApp del vendedor | `seller_profiles.contact_phone` | `contact_phone_enc` |

## v1 congelado

El código y este documento usan los mismos parámetros. No los cambies en un lado solo.

- Cifrado: AES-256-GCM. Nonce 12 bytes, tag 16 bytes, después el ciphertext.
- Blob: `pii:v1:<kid>:<base64url(nonce 12 ‖ tag 16 ‖ ciphertext)>`.
- AAD: `meteorito:pii:v1|<tabla>.<columna>|<clave>`. Clave de fila: `order_id|channel` o `sub` del vendedor.
- HKDF-SHA256 de la llave maestra (32 bytes). Salt UTF-8 `meteorito:pii:v1`. Info UTF-8 `enc`. Largo 32. Esa salida es la llave AES.

Mientras existan las dos columnas, un guardado escribe las dos **si hay llave**. Sin llave, guardar responde **503 `pii_unavailable`** y no toca la fila. Al leer, si hay llave se usa `*_enc` cuando abre; si el blob no abre, el campo queda null (no se usa el claro). Si todavía no hay blob, se usa el claro y el log dice `pii_read_plain` **sin el valor**. En esta fase, **sin llave, la lectura usa el claro** para que el WhatsApp del vendedor, `admin_contacts` y los avisos por correo sigan funcionando.

## Variables

| Variable | Qué es |
|---|---|
| `PII_ENC_KEYS` | `kid:base64,kid2:base64`. Cada valor es 32 bytes. Sensitive. |
| `PII_ENC_ACTIVE_KID` | Kid que cifra. Los demás solo descifran (rotación). Sensitive. |

No hay fallback a `PIN_PEPPER`, `ORDER_ACCESS_SECRET` ni a ningún otro secreto. `/api/health` dice `pii: ok`, `missing` o `bad_format`, sin el material.

Production y Preview tienen proyectos de Supabase distintos. Preview es `meteorito-preview` (ref `nqukipgxnnsmqtcivpzr`), con las migraciones 001–037 y datos sintéticos. Cada entorno usa las llaves que tenga cargadas. No copies la llave de Production a Preview.

Hasta que existan las columnas (051) y las llaves de ese entorno, guardar el WhatsApp del vendedor o el contacto del comprador responde 503. Leer, en esta fase, sigue mostrando el claro. El resto de la tienda sigue igual.

## Migración 051

Archivo: `supabase/migrations/051_pii_enc.sql`. Solo agrega columnas, checks de formato, afloja el check del canal para aceptar claro o cifrado, y avisa a PostgREST (`notify pgrst, 'reload schema'`).

**No la aplica el deploy.** Vitalik la aplica con Supabase `apply_migration`. Avísale antes de aplicarla.

## Llaves (no corras `--apply` contra Vercel sin el OK de Rolando)

```bash
npx tsx scripts/ops/pii-enc-keys.ts                         # dry-run: no genera ni imprime una llave
npx tsx scripts/ops/pii-enc-keys.ts --self-test             # prueba en memoria; no llama a Vercel
npx tsx scripts/ops/pii-enc-keys.ts --apply --target production
npx tsx scripts/ops/pii-enc-keys.ts --apply --target preview
```

`--apply` exige `VERCEL_TOKEN` y `VERCEL_PROJECT_ID` (`VERCEL_ORG_ID` si es un team). Genera 32 bytes con CSPRNG. Antes de llamar a Vercel escribe una copia en `/home/box/secrets/pii-<target>-<kid>.txt` con modo `0600`. Ese archivo es para Rolando: se lo pasas fuera de línea y después lo borras. El script no imprime la llave, no la acepta por argumentos y no reemplaza una variable que ya existe. Cada corrida genera una llave nueva, así Production y Preview no comparten material.

El orden de carga es `PII_ENC_KEYS` y después `PII_ENC_ACTIVE_KID`. **Cuando termine, redespliega** para que las funciones tomen las variables nuevas.

**No ejecutes `--apply` contra Vercel hasta que Rolando lo autorice.** Este cambio no carga secretos.

## Backfill

Lo corre un admin **dentro de Vercel** (ahí está la llave Sensitive). No hace falta copiar `PII_ENC_KEYS` a tu máquina.

`POST /api/store` con sesión de un correo de `ADMIN_EMAILS`:

```json
{ "action": "admin_pii_backfill" }
{ "action": "admin_pii_backfill", "apply": true }
```

Sin `apply: true` es dry-run: no escribe. La respuesta son conteos (`contactsReady`, `phonesWrote`, `sellerEmailsNulled`, …). No devuelve teléfono ni correo. Idempotente: cifra filas con claro y `*_enc` null, comprueba el descifrado en memoria y solo entonces escribe el blob. También pone `orders.seller_email` en null. Queda una fila en `admin_audit` (`pii_backfill`) con los mismos conteos.

Hazlo **después** de que Vitalik aplicó la 051, **después** de que las llaves están en ese entorno y **después** del redespliegue.

## Fuera de este PR

Migración 052 (borrar el claro). Antes de ese cutover, `buyer_access_request` tiene que descifrar el correo y compararlo con `timingSafeEqual` (hoy busca por el claro). También quedan fuera `ORDER_ACCESS_SECRET` / `CAPTURE_SECRET` / `RATE_LIMIT_SALT`, mainnet, iOS, y generar la llave de Harvey.
