# Captura rápida — iPhone → Segunda Mente

Google Sheets y `Abrir URL` quedan fuera del flujo.

## Flujo definitivo

`Botón Acción → escribir o dictar → POST /api/capture → Segunda Mente`

La petición se guarda en `mind_captures` y el servidor clasifica inicialmente la entrada como gasto, ingreso, tarea, idea o nota. La futura capa de interpretación puede sustituir esta clasificación sin cambiar el Atajo.

## Atajo recomendado

1. En **Atajos**, crea un atajo llamado **Segunda Mente**.
2. Añade **Elegir del menú** con dos opciones: `Escribir` y `Hablar`.
3. En `Escribir`, usa **Pedir entrada** (texto). En `Hablar`, usa **Dictar texto**.
4. Guarda el resultado de cualquiera de las dos ramas en una variable `Captura`.
5. Añade **Obtener contenido de URL**:
   - URL: `https://TU-DOMINIO/api/capture`
   - Método: `POST`
   - Cabecera `Authorization`: `Bearer TU_CAPTURE_TOKEN`
   - Cuerpo JSON: `{ "text": Captura }`
6. Añade **Mostrar notificación**: `Guardado en Segunda Mente ✓`.
7. Asigna el atajo **Segunda Mente** al botón Acción.

El Atajo no abre Safari ni la PWA. Solo envía la captura en segundo plano.

## Variables privadas de Vercel

Configurar solo en servidor:

- `CAPTURE_TOKEN`: secreto largo y aleatorio que también se copia en el Atajo.
- `SUPABASE_URL`: URL del proyecto dedicado a Segunda Mente.
- `SUPABASE_SERVICE_ROLE_KEY`: clave de servidor; nunca se copia al iPhone ni al frontend.

Aplicar `supabase/migrations/001_mind_captures.sql` al proyecto dedicado antes de probar el endpoint.

## Ejemplos

- `He pagado 16,40 € en Mercadona`
- `He gastado 52 € en gasolina`
- `Recuérdame llamar mañana al taller`
- `Idea: simplificar el onboarding`

La persistencia ya no depende de `localStorage` ni de Google Sheets para las capturas hechas desde el Atajo.