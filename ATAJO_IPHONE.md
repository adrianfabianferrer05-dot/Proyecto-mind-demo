# Captura rápida — iPhone → Segunda Mente

Google Sheets y `Abrir URL` quedan fuera del flujo.

## Flujo definitivo

`Botón Acción → escribir o dictar → POST a la Edge Function capture → Segunda Mente`

La petición se guarda en `mind_captures` y la interpreta **el mismo intérprete que la app**: si hay clave de OpenAI conectada, el mismo modelo; si no, el mismo `interpret.js`. Lo que dictas al Atajo y lo que escribes en la app se entienden igual, que antes no era el caso.

### Dónde apunta

- **Canónico:** `https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/capture`
- **Antiguo:** `https://TU-DOMINIO/api/capture` sigue funcionando, pero ya no hace nada por su cuenta: sólo reenvía a la anterior. Si tu Atajo apunta aquí, funciona igual; cuando puedas, cámbialo al canónico y te quitas un salto y una dependencia de Vercel.

Por qué la de Supabase: Supabase ya es crítico (base de datos, avisos, banco, gym, voz) y Vercel sólo sirve ficheros estáticos. Que además tuviera que estar vivo para que funcione el Atajo era un punto de fallo de más. Y la versión de Vercel necesitaba la `SUPABASE_SERVICE_ROLE_KEY` —la credencial que se salta RLS entera— para un endpoint que ya no usaba nadie.

## Atajo recomendado

1. En **Atajos**, crea un atajo llamado **Segunda Mente**.
2. Añade **Elegir del menú** con dos opciones: `Escribir` y `Hablar`.
3. En `Escribir`, usa **Pedir entrada** (texto). En `Hablar`, usa **Dictar texto**.
4. Guarda el resultado de cualquiera de las dos ramas en una variable `Captura`.
5. Añade **Obtener contenido de URL**:
   - URL: `https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/capture`
   - Método: `POST`
   - Cabecera `Authorization`: `Bearer TU_CAPTURE_TOKEN`
   - Cuerpo JSON: `{ "text": Captura }`
6. Añade **Mostrar notificación**: `Guardado en Segunda Mente ✓`.
7. Asigna el atajo **Segunda Mente** al botón Acción.

El Atajo no abre Safari ni la PWA. Solo envía la captura en segundo plano.

## Dónde vive el token

En el **Vault de Supabase**, con el nombre `segunda_mente_capture_token`. La Edge Function lo lee de ahí y lo compara en tiempo constante; no aparece en el código ni viaja al navegador. En el Atajo va la misma cadena, en la cabecera `Authorization`.

Vercel ya no necesita nada para esto: `CAPTURE_TOKEN`, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se pueden borrar de sus variables de entorno, porque `/api/capture` se quedó sin lógica propia.

El esquema se levanta con `supabase/migrations/20260916181839_baseline.sql` (ver `docs/MIGRACIONES.md`).

## Ejemplos

- `He pagado 16,40 € en Mercadona`
- `He gastado 52 € en gasolina`
- `Recuérdame llamar mañana al taller`
- `Idea: simplificar el onboarding`

La persistencia ya no depende de `localStorage` ni de Google Sheets para las capturas hechas desde el Atajo.