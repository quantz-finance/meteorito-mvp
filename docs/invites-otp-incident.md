# Invitación tras login por correo (7 nov 2026)

## Evidencia (hora de Costa Rica, UTC-6)

- Producción `dpl_Cspz7HRSNu9HW7uCLqnbjDTbP662`, main `5c35b688`.
- A las 16:38:31.918 y 16:40:38.586, `POST /api/store` registró
  `[auth] issuer rechazado {"iss":"https://enclave.cavos.xyz","aud":"cavos-email"}`.
- La consulta de runtime logs entre 16:38 y 16:44 solo devolvió esos dos avisos.
  Una búsqueda de `/api/invites` entre 16:30 y 16:48 no devolvió registros.
  Esto no prueba que ningún request haya llegado; no hay evidencia del supuesto timeout del servidor.
- SELECT agregado: cero invitaciones creadas entre 16:30 y 16:45.
- Supabase, 16:38–16:43: 6 eventos Postgres rutinarios (checkpoint y cron ya existentes),
  1 lectura API exitosa; sin errores ni inserciones de invitaciones en los registros devueltos.

## Diagnóstico

El kit 0.5 emite tokens de correo desde el enclave (ES256), pero el backend todavía
configuraba emisores/JWKS/audiencias legacy. #157 hizo obligatoria esta verificación al crear
invitaciones y expuso el problema. #158 solo tradujo errores de recuperación de otro dispositivo.
No hay evidencia de caída de Cavos; el JWKS público respondió durante la investigación.

Crear una invitación con token fresco no necesita dirección, firma, passkey ni frase de
recuperación en el servidor. El cliente, sin embargo, esperaba `ensureBound` antes de todas
las escrituras: nonce + firma Cavos + bind, sin deadline. Se elimina esa dependencia únicamente
para crear invitaciones; pagos, firmas y renovación de token vencido conservan sus pruebas.
No es posible atribuir el spinner exacto a ese paso sin el trace del navegador.

`auth_invalid` abre el modal vía `onRelogin` y espera un token nuevo hasta 180 s.
En el kit, el OTP exitoso deja `busy=true`; el cierre/reapertura no lo limpiaba y los botones
usan `disabled: busy`. El parche de postinstall limpia ese estado al cambiar `open`, sin logout
ni borrar llaves, y hace reintentable el modal.

La rama create del handler no llama a Brevo, Cavos wallet ni Stellar para tokens frescos.
Solo verifica JWT/JWKS, valida entradas/fotos, consulta límites/riesgo en Supabase e inserta.
Los flags de vendedor/correos solo intervienen en las operaciones seller_*; no causan este rechazo.

## Publicación (necesaria además del commit)

`CAVOS_JWT_ISSUERS` YA existe en Vercel Production y Preview, por lo que gana sobre el default
nuevo. Agregar `https://enclave.cavos.xyz` a la lista existente, sin quitar los emisores actuales,
y volver a publicar. No basta con desplegar el código si queda el override antiguo.
El conector devolvió la metadata pero no el valor de esas variables sensibles.

NO reemplazar globalmente `CAVOS_JWT_AUDIENCE` por cavos-email ni cambiar el JWKS global:
el código enruta audiencia y claves según el emisor. Se mantiene el requisito de audiencia
configurada, la firma, expiración y lista explícita de emisores; no hay fallback a invitado.

## Límites de la verificación

Tests con JWKS local, tokens ES256 sintéticos, base simulada y fetch colgado simulado.
Sin cambios de base, env de producción, envío de correo, despliegue ni recorrido real del navegador.
Los tests on-chain se omiten con TESTNET=skip. Ningún texto legal aprobado cambia.
