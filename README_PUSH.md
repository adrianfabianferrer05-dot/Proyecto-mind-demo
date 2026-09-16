# Segunda Mente · Web Push

Arquitectura de notificaciones para la PWA instalada en iPhone:

- `sw.js` recibe eventos Web Push, muestra la notificación y gestiona el clic.
- `activar-notificaciones.html` solicita permiso desde una interacción del usuario y registra la suscripción Push.
- Supabase Edge Function `push` gestiona registro y envío.
- Las claves VAPID privadas y el token de envío viven fuera del repositorio, en Supabase Vault.
- Las suscripciones se almacenan en `public.push_subscriptions` con RLS habilitado y sin acceso para `anon`/`authenticated`.
- El registro inicial requiere un código temporal de un solo uso.

No guardar secretos VAPID ni tokens privados en este repositorio.
