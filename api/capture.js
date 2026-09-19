/* /api/capture — PUERTA ANTIGUA. Aquí ya no se interpreta ni se guarda nada: esto
   sólo reenvía a la Edge Function `capture`, que es la implementación real.

   Por qué esta y no la otra:

   Había dos puertas para el Atajo de iPhone, y aunque desde hace poco compartían
   intérprete seguían siendo dos implementaciones. La canónica es la de Supabase:

   - Menos piezas. Supabase ya es crítico (base de datos, avisos, banco, gym, voz).
     Vercel sirve ficheros estáticos; que además tenga que estar vivo para que
     funcione el Atajo es un punto de fallo de más, y uno que se cae por su cuenta.
   - Mejor autenticación. Esta versión necesitaba `SUPABASE_SERVICE_ROLE_KEY` en
     Vercel: la credencial más peligrosa del proyecto —se salta RLS entera— metida
     en un sitio más, para un endpoint que nadie usaba. La Edge Function usa un
     token propio guardado en el Vault y lo compara en tiempo constante.
   - Un solo intérprete de verdad. `capture` usa el mismo `interpret.js` que `mind`
     y, si hay clave de OpenAI, el mismo modelo. Esta versión sólo sabía del
     intérprete local: el Atajo entendía peor que la app por el mero hecho de entrar
     por otra puerta.

   Que el Atajo ya usa la de Supabase no es una suposición: las dos últimas capturas
   reales traen `version: 6` e `interpreter`, campos que sólo escribe la Edge
   Function. Ninguna captura tiene la firma que escribía este fichero.

   Se deja como proxy y no se borra para no romper nada si alguna copia del Atajo
   sigue apuntando aquí. Sin lógica propia: pasa la cabecera de autorización tal
   cual y devuelve la respuesta tal cual. Cuando no quede ningún cliente apuntando a
   esta ruta, el fichero puede desaparecer y no se pierde nada.

   Al quedarse sin lógica, Vercel ya no necesita `CAPTURE_TOKEN`, `SUPABASE_URL` ni
   `SUPABASE_SERVICE_ROLE_KEY`. Se pueden borrar de sus variables de entorno. */
const DESTINO = 'https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/capture';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405);
    return res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
  }

  /* Vercel puede entregar el cuerpo ya parseado o como texto; se reenvía tal cual
     llegue, sin mirarlo: validar aquí seria volver a tener dos implementaciones. */
  const cuerpo = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const cabeceras = { 'Content-Type': 'application/json' };
  if (req.headers.authorization) cabeceras.Authorization = req.headers.authorization;
  if (req.headers['x-capture-token']) cabeceras['x-capture-token'] = req.headers['x-capture-token'];

  try {
    const r = await fetch(DESTINO, { method: 'POST', headers: cabeceras, body: cuerpo });
    const texto = await r.text();
    res.status(r.status);
    return res.end(texto || '{}');
  } catch (error) {
    console.error('capture_proxy_failed', error);
    res.status(502);
    return res.end(JSON.stringify({ ok: false, error: 'upstream_unreachable' }));
  }
}
