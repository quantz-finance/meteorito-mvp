# Avisos y recuperación del comprador sin cuenta

El comprador paga sin cuenta (llave del navegador, ver `guest-checkout.md`). Si borra el navegador o cambia de teléfono perdía
el acceso. Ahora, después de pagar, `/p/<slug>` muestra la tarjeta opcional **"Recibe avisos de tu compra"**:

| Opción | Qué se guarda | Cómo recupera el acceso |
|---|---|---|
| WhatsApp (+506 por defecto) | `buyer_contacts.phone_e164` | El equipo le escribe con el wa.me de `admin_contacts` (link de acceso incluido) |
| Correo | `buyer_contacts.email` | Correo con link de acceso (Brevo) al guardar y en cada aviso |
| Crear cuenta | `buyer_links` (llave ↔ cuenta Cavos) | Entra con su cuenta en cualquier teléfono: Mis compras incluye la compra |

- Consentimiento: casilla obligatoria; se guarda el texto exacto y `consent_text_version` (`api/_lib/contactText.ts`).
- El teléfono y el correo NUNCA se muestran al vendedor. El comprador los ve enmascarados; el equipo, con `ADMIN_EMAILS`.
- Nunca bloquea el pago ni navega: WhatsApp/correo se guardan en la misma página; "Crear cuenta" abre el login de Cavos sobre
  `/p/<slug>` (redirect_uri = esa URL) y al volver vincula la llave (`meteorito:contact:link-pending`).

## Link de acceso

HMAC-SHA256 sin estado (`ORDER_ACCESS_SECRET`, o `PIN_PEPPER` si no está): `{link, slug, buyer_user_id, exp 7 días}`.
Al abrir `/p/<slug>?acceso=<token>` el servidor (`buyer_access_redeem`) devuelve un permiso `{grant, slug, buyer, exp 120 días}`
que el dispositivo guarda (`meteorito:guest:access:<slug>`) y manda en `X-Order-Access`. Vale SOLO para ese pedido
(`requireBuyerIdentity` lo acepta cuando `body.slug` coincide). El token se quita de la URL. En el dispositivo recuperado,
"Generar código nuevo" rota el PIN (`buyer_pin_reissue`, el anterior deja de servir, queda `pin_reissued` en order_events).
Otro dispositivo sin acceso: "¿Pagaste tú? Recupera tu acceso" pide un link al correo guardado (respuesta siempre igual).

## Avisos

`advance()` (db.ts) -> `notifyBuyerStatus`: pagado, enviado, liberado, disputa, resuelto. El cron (cada 5 min) ->
`notifyDueSoon`: "el pago se libera en menos de 24 h". Además del push. Un aviso por estado y canal (índice único) y
máximo 6 por canal en 24 h. Cada aviso trae las tres vías (link con acceso, WhatsApp, cuenta) y el aviso de beta.
WhatsApp queda como `pending_manual` en `buyer_notifications` (no hay API de envío).

## Configuración

| Variable | Para qué |
|---|---|
| `GUEST_EMAIL_ENABLED=1` | Enciende los correos (sin esto se guardan como `skipped`) |
| `BREVO_API_KEY` | API key de Brevo (la misma cuenta del landing) |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | Remitente (default `hola@meteorito.app` / `Meteorito`, debe estar validado en Brevo) |
| `ORDER_ACCESS_SECRET` | Llave de los links (opcional; default `PIN_PEPPER`). Cambiarla invalida los links emitidos |
| `APP_URL` | Base de los links (default `https://pago.meteorito.app`) |
| `ADMIN_EMAILS` | Correos del equipo que pueden pedir `admin_contacts` (wa.me listos) |

Sin la migración 028: la tarjeta no aparece, no hay vínculo ni correos, y los links de acceso siguen funcionando.
