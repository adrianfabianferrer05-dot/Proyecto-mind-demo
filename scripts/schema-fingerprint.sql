-- Huella del esquema: una lista de lineas ordenada y estable que describe todo lo
-- que una instalacion limpia tiene que reproducir. Se ejecuta igual contra
-- produccion y contra el Postgres de verificacion, y si las dos huellas coinciden,
-- la baseline representa de verdad lo que hay desplegado.
--
-- Se compara `prosrc` (el cuerpo de la funcion tal cual se guardo) y no
-- `pg_get_functiondef`, porque el segundo lo reescribe el motor y cambia de forma
-- entre versiones de Postgres: daria diferencias que no son diferencias.
with cols as (
  select format('col|%s|%s|%s|%s|%s', c.relname, a.attname,
                format_type(a.atttypid, a.atttypmod),
                case when a.attnotnull then 'NOT NULL' else 'NULL' end,
                coalesce(pg_get_expr(d.adbin, d.adrelid), '-')) as l
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
),
cons as (
  -- Postgres 17 reescribe `btrim(x)` como `TRIM(BOTH FROM x)` al deparsear, y 16
  -- no. Es la misma funcion: se normaliza para que la huella compare esquemas y no
  -- versiones del motor.
  select format('con|%s|%s|%s', t.relname, c.conname,
                replace(pg_get_constraintdef(c.oid), 'TRIM(BOTH FROM ', 'btrim(')) as l
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
),
idx as (select format('idx|%s', indexdef) as l from pg_indexes where schemaname = 'public'),
trg as (
  select format('trg|%s|%s|%s', c.relname, tg.tgname, pg_get_triggerdef(tg.oid)) as l
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not tg.tgisinternal
),
rls as (
  select format('rls|%s|%s', c.relname, c.relrowsecurity) as l
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
pol as (select format('pol|%s', count(*)) as l from pg_policies where schemaname in ('public', 'private')),
fun as (
  select format('fun|%s.%s(%s)|secdef=%s|%s|%s|%s',
                n.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
                p.prosecdef, l.lanname, md5(p.prosrc),
                coalesce(array_to_string(p.proconfig, ','), '-')) as l
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname in ('public', 'private') and p.prokind = 'f'
),
ident as (
  select format('ident|%s.%s|%s', c.relname, a.attname, a.attidentity) as l
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and a.attidentity <> ''
),
seq as (
  select format('seq|%s', c.relname) as l
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'
),
todo as (
  select l from cols
  union all select l from cons
  union all select l from idx
  union all select l from trg
  union all select l from rls
  union all select l from pol
  union all select l from fun
  union all select l from ident
  union all select l from seq
)
select string_agg(l, E'\n' order by l) as huella from todo;
