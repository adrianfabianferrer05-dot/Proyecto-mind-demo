# Migraciones: por qué una baseline

## El problema

Producción tenía **30 migraciones aplicadas**. El repositorio tenía **5 ficheros**.
Las 25 que faltaban sólo existían dentro de la base de datos: si el proyecto se
hubiera tenido que levantar desde cero, no se habría podido. La aplicación
funcionaba, pero su esquema no era reproducible.

## Por qué no se han reescrito las 25

Porque no se puede hacer honestamente. El historial real contiene:

- nombres repetidos: `personal_app_device_access` dos veces,
  `index_gym_sessions_day` dos veces, `personal_app_schema_verify` dos veces;
- cinco migraciones de nueve caracteres, que no hacen nada;
- columnas que se añadieron en una y se quitaron en otra (`planned_weight_kg`,
  `working_weight_kg`, la preferencia `gym`);
- pasos de verificación guardados como si fueran cambios de esquema.

Reconstruir eso sería inventar una cronología que nunca existió. Una cronología
inventada es peor que no tener historial: parece historia y no lo es, y la primera
persona que la lea para entender por qué algo es como es se llevará una respuesta
falsa.

## Qué hay en su lugar

Un único fichero, `supabase/migrations/20260916181839_baseline.sql`, con el esquema
completo: extensiones, esquema `private`, las 19 tablas, sus constraints, los 56
índices, las 7 funciones, los 4 triggers, RLS en todas las tablas, las filas que
tienen que existir y las dos tareas de cron.

Es el aplanamiento estándar de migraciones (lo que hace `supabase migration
squash`). La versión del fichero es la de la primera migración histórica
(`20260916181839`), que ya consta como aplicada en producción: así un `db push`
nunca intenta ejecutarlo contra la base que ya existe, y una instalación limpia lo
usa como punto de partida.

A partir de aquí, cada cambio de esquema es un fichero nuevo con su fecha. El
historial vuelve a ser real porque vuelve a empezar.

## Cómo se ha verificado

No por inspección: por reproducción.

1. Se introspecciona producción y se saca una **huella** del esquema: una línea por
   columna, constraint, índice, trigger, función, tabla con RLS, identidad y
   secuencia. La consulta está en `scripts/schema-fingerprint.sql`.
2. Se aplica la baseline contra un Postgres vacío.
3. Se saca la huella del resultado con la misma consulta.
4. Se comparan.

Resultado, el 19 de septiembre de 2026 (producción en PostgreSQL 17.6, verificación
en 16.13):

| sección | líneas | producción | baseline |
|---|---:|---|---|
| columnas | 181 | `fd9cbadb…` | `fd9cbadb…` |
| constraints | 65 | `27e02f0d…` | `27e02f0d…` |
| índices | 56 | `1b0485f3…` | `1b0485f3…` |
| triggers | 4 | `09aca835…` | `09aca835…` |
| funciones | 7 | `3d136129…` | `3d136129…` |
| RLS | 19 | `ab1000c5…` | `ab1000c5…` |
| políticas | 0 | `9fd400df…` | `9fd400df…` |
| identidades | 1 | `0199ebae…` | `0199ebae…` |
| secuencias | 2 | `0c4d3e4a…` | `0c4d3e4a…` |

Las nueve coinciden.

Dos diferencias aparecieron por el camino y eran reales, no de formato:

- `notification_log.id` es `generated ALWAYS as identity` en producción, no `by
  default`. La baseline decía `by default` y se corrigió.
- `bank_setup_events.id` es un `bigserial` (secuencia + `nextval`), no una columna
  de identidad. Se corrigió igual.

Una tercera sí era de formato: PostgreSQL 17 reescribe `btrim(x)` como `TRIM(BOTH
FROM x)` al deparsear y 16 no. Es la misma función, así que la huella lo normaliza
—compara esquemas, no versiones del motor.

## Qué se comprueba en cada commit

`npm run schema` (y CI) levanta un Postgres de usar y tirar, aplica **todos** los
ficheros de `supabase/migrations` en orden y compara con
`supabase/schema.fingerprint.txt`. Si una migración nueva cambia el esquema y no se
actualiza la huella, falla y dice exactamente qué línea sobra o falta.

Cuando el cambio es intencionado: primero la migración, después
`npm run schema:huella`, y el fichero regenerado entra en el mismo commit. Ese orden
importa: la huella no se toca "para que pase el test", se regenera porque alguien ha
escrito antes la migración que lo justifica.

## Qué NO cubre la huella

Con honestidad, porque un check que promete de más es peor que uno que promete poco:

- **Extensiones y cron.** `pg_net` y `pg_cron` son de Supabase y no existen en un
  Postgres normal, así que en la verificación local esas dos líneas se anulan. Se
  comprobaron directamente contra producción: `pgcrypto`, `uuid-ossp`, `pg_net`,
  `pg_cron`, `pg_stat_statements` y `supabase_vault` instaladas, y las dos tareas de
  cron (`dispatch` y `reconcile`) activas cada minuto.
- **El Vault.** Los secretos (clave de OpenAI, token del atajo, token de envío de
  push) no están ni pueden estar en una migración. Una instalación nueva tiene que
  crearlos.
- **Los datos.** La baseline crea las filas que el sistema necesita para funcionar
  (la fila de preferencias, los siete días de la semana). Nada más: ni capturas, ni
  rutina, ni movimientos.
