# Activación segura de notificaciones

1. La PWA instalada carga `activar-notificaciones.html` mientras no exista una suscripción confirmada.
2. El usuario pega un código temporal de un solo uso entregado por un canal privado.
3. iOS solicita permiso de notificaciones desde el gesto del usuario.
4. El navegador crea una suscripción Push usando la clave VAPID pública.
5. La Edge Function valida el hash del código, guarda la suscripción y envía una notificación de prueba.
6. Solo tras una prueba correcta se marca el código como usado y el Service Worker deja de mostrar la pantalla de activación.

La clave VAPID privada y el token de envío viven en Supabase Vault, no en GitHub ni en el navegador.
