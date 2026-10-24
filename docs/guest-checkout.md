# Checkout de invitado (comprador sin cuenta)

**Decisión (MVP testnet):** quien abre un link de pago `/p/<slug>` **no inicia sesión ni crea wallet** para pagar.

## Cómo funciona
1. El navegador del comprador genera una **llave secreta aleatoria** (32 bytes, hex) y la guarda en `localStorage` (`meteorito:guest:v1`). Viaja en el header `X-Guest-Key`.
2. El servidor **no la guarda**. Identidad del comprador: `buyer_user_id = "guest:" + sha256("meteorito-guest-v1:" + llave)[0..40]`.
3. `POST /api/escrow/pay` `start`: despliega el escrow Trustless Work con la wallet **`platform`** como `buyer_address` (no hay wallet del comprador). `confirm_sinpe` ("Ya pagué") lo fondea con la treasury de testnet (SINPE simulado). El PIN de entrega se devuelve una vez y se guarda también en el navegador del comprador.
4. Confirmar recepción (`/api/escrow/confirm`, `buyer_confirm`) y abrir disputa (`/api/escrow/dispute`) exigen la misma llave: solo el navegador que pagó puede hacerlo. Las cuentas Cavos que ya habían comprado antes siguen funcionando (el servidor acepta el `sub` de Cavos **o** la llave).
5. El vendedor sigue usando Cavos (necesita wallet para cobrar). Si el vendedor abre su propio link con sesión iniciada, el servidor responde `self_purchase` (409).

## Límites (a propósito, y por qué son aceptables en testnet)
- **La llave es un secreto portador**: quien la copie actúa como comprador de ese pedido. Si el navegador borra sus datos, se pierde el acceso (confirmar/disputar) y el PIN guardado; por eso la hoja del PIN pide anotarlo. El auto-release (`AUTO_RELEASE_MINUTES`) libera igual si no hay disputa.
- **Reembolsos de disputas**: como el `buyer_address` es la wallet `platform`, el resolvedor (script manual) envía la parte del comprador a `platform` y el equipo la devuelve por fuera. No existe reembolso automático al invitado.
- **Sin pago directo en USDC** para invitados (necesita wallet propia); SINPE simulado o **tarjeta** (Lendara sandbox, ver `docs/lendara-card.md`).
- **Sin fotos de evidencia** en disputas de invitados (la subida exige cuenta); describen el problema en texto.
- **Sin anti-abuso por IP**: cualquiera puede iniciar pagos simulados que consumen treasury de testnet. En mainnet esto exigiría pago real (SINPE/cripto) del propio comprador, verificación de contacto y límites por IP/dispositivo.
- No se verifica identidad del comprador: no es KYC.

Tests: `scripts/ci/t26-guest.test.ts`.
