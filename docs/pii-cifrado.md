# PII en reposo (fases A–C)

Teléfono y correo se cifran en el servidor (`api/_lib/pii.ts`, AES-256-GCM). El cliente no ve la llave ni el módulo.
Esta entrega **no** borra el texto en claro (eso es la migración 052, otro PR) y **no** cifra IBAN, SINPE, titular,
`display_name` ni `buyer_name`. `orders.seller_email` se deja de escribir; el backfill lo pone en null. La columna se elimina en el PR 2.

| Dato | Columna en claro (sigue) | Columna cifrada |
|---|---|---|
| WhatsApp / teléfono del comprador | `buyer_contacts.phone_e164` | `phone_e164_enc` |
| Correo del comprador | `buyer_contacts.email` | `email_enc` |
| WhatsApp del vendedor | `seller_profiles.contact_phone` | `contact_phone_enc` |

Blob: `pii:v1:<kid>:<base64url(nonce 12 ‖ tag 16 ‖ ciphertext)>`.
AAD: `meteorito:pii:v1|<tabla>.<columna>|<clave>`. Clave de fila: `order_id|channel` o `sub` del vendedor.
La llave AES sale por HKDF-SHA256 de la llave maestra (32 bytes), salt `meteorito:pii:v1`, info `enc`.

Mientras existan las dos columnas, un guardado escribe las dos. Al leer se usa `*_enc` si abre; si todavía es null, el claro, y el log dice `pii_read_plain` **sin el valor**.

## Variables

| Variable | Qué es |
|---|---|
| `PII_ENC_KEYS` | `kid:base64,kid2:base64`. Cada valor es 32 bytes. Sensitive. |
| `PII_ENC_ACTIVE_KID` | Kid que cifra. Los demás solo descifran (rotación). Sensitive. |

No hay fallback a `PIN_PEPPER`, `ORDER_ACCESS_SECRET` ni a ningún otro secreto.

El cifrado solo se arma con `VERCEL_ENV=production`. En Preview, development o si `VERCEL_ENV` no es exactamente `production`, el servidor **no lee** `PII_ENC_*`: guardar un contacto responde **503 `pii_unavailable`** y leer ese campo devuelve null. No hace falta (ni se debe) poner las llaves de Production en esos entornos.

Preview comparte hoy el proyecto de Supabase de Production. Por eso **Preview no debe tener variables `PII_ENC_*`**. Este PR solo entrega el fail-closed y el dual-write de Production. Cifrar en un entorno que no sea Production exige antes una de estas dos cosas:

- un proyecto de Supabase distinto del de Production, o
- datos sintéticos en Preview, sin PII real.

Hasta que eso exista, no se habilita el cifrado fuera de Production.

Hasta que existan las columnas (051) y las llaves de Production, guardar el WhatsApp del vendedor o el contacto del comprador responde 503. El resto de la tienda sigue igual.

## Migración 051

Archivo: `supabase/migrations/051_pii_enc.sql`. Solo agrega columnas, checks de formato y afloja el check del canal para aceptar claro o cifrado.

**No la aplica el deploy.** Vitalik la aplica con Supabase `apply_migration`. Avisarle antes de aplicarla.

## Llaves (no correr contra Vercel sin el OK de Rolando)

```bash
npx tsx scripts/ops/pii-enc-keys.ts                  # dry-run: no genera ni imprime una llave
npx tsx scripts/ops/pii-enc-keys.ts --self-test      # prueba en memoria; no llama a Vercel
npx tsx scripts/ops/pii-enc-keys.ts --apply --target production
```

`--apply` exige `VERCEL_TOKEN` y `VERCEL_PROJECT_ID` (`VERCEL_ORG_ID` si es un team). Genera 32 bytes con CSPRNG y los carga como variables **Sensitive** solo en el target Production. No imprime la llave, no la escribe a disco y no acepta material de llave por argumentos. Si la variable ya existe en Production, no la reemplaza.

`--target preview` y `--target development` se rechazan y no llaman a Vercel. No subas `PII_ENC_*` a Preview mientras comparta la base de Production.

**No ejecutar `--apply` contra Vercel hasta que Rolando lo autorice.** Este cambio no carga secretos.

## Backfill

Idempotente. Cifra filas con claro y `*_enc` null, comprueba el descifrado en memoria y solo entonces escribe el blob. También pone `orders.seller_email` en null. Imprime conteos, nunca el dato.

```bash
VERCEL_ENV=production npx tsx scripts/ops/pii-backfill.ts             # dry-run: cuenta, no escribe
VERCEL_ENV=production npx tsx scripts/ops/pii-backfill.ts --self-test # ronda en memoria, sin base
VERCEL_ENV=production npx tsx scripts/ops/pii-backfill.ts --apply     # escribe. Exige 051, llaves y service role
```

`--apply` usa `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PII_ENC_KEYS` y `PII_ENC_ACTIVE_KID`, y solo si `VERCEL_ENV` es exactamente `production`. En Preview o en cualquier otro entorno el script se niega y no toca la base. `VERCEL_ENV=production` aquí afirma que corrés el backfill de Production con las llaves de Production: no es un permiso para Preview. Correrlo **después** de que Vitalik aplicó la 051 y **después** de que las llaves están en Production.

## Fuera de este PR

Migración 052 (borrar el claro), `ORDER_ACCESS_SECRET` / `CAPTURE_SECRET` / `RATE_LIMIT_SALT`, mainnet, iOS, y generar la llave de Harvey.
