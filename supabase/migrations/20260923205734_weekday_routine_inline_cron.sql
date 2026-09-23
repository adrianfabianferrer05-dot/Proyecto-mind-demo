-- El perfil de rutina vive como dato en mind_captures. Para el aviso recurrente no
-- hace falta ampliar el esquema: pg_cron puede construir una sola entrada diaria
-- directamente. Retiramos la columna/funcion auxiliar del paso anterior y dejamos
-- el esquema publico/privado igual que antes del cambio.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('segunda-mente-afternoon-routine')
      where exists (select 1 from cron.job where jobname = 'segunda-mente-afternoon-routine');
  end if;
end $$;

drop function if exists private.enqueue_afternoon_routine_summary(timestamptz);
drop index if exists public.notification_queue_dedupe_key_uidx;
alter table public.notification_queue drop column if exists dedupe_key;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'segunda-mente-afternoon-routine',
      '* * * * *',
      $cron$
with routine as (
  select id, metadata,
         coalesce(nullif(metadata->>'timezone',''), 'Europe/Madrid') as tz
  from public.mind_captures
  where source = 'system_routine'
    and metadata->>'routine_profile' = 'weekday_v1'
    and archived_at is null
    and coalesce((metadata->>'active')::boolean, false)
  order by updated_at desc
  limit 1
), due as (
  select r.*,
         now() at time zone r.tz as local_now,
         extract(dow from (now() at time zone r.tz))::smallint as local_dow,
         coalesce((r.metadata->>'summary_time')::time, time '15:20') as summary_time
  from routine r
), ready as (
  select *
  from due
  where exists (
    select 1
    from jsonb_array_elements_text(coalesce(metadata->'notify_weekdays','[]'::jsonb)) d(value)
    where d.value::smallint = local_dow
  )
    and local_now::time >= summary_time
    and local_now::time < summary_time + interval '2 minutes'
)
insert into public.notification_queue(title, body, target_url, scheduled_at, status, capture_id)
select
  'Tu tarde',
  left(
    coalesce(nullif(metadata->>'afternoon_push',''), 'Tienes tu rutina de la tarde pendiente.')
    || case when local_dow = 5 and nullif(metadata->>'friday_push','') is not null
            then ' ' || (metadata->>'friday_push') else '' end,
    220
  ),
  '/',
  now(),
  'queued',
  id
from ready
where not exists (
  select 1
  from public.notification_queue q
  where q.capture_id = ready.id
    and q.title = 'Tu tarde'
    and (q.scheduled_at at time zone ready.tz)::date = ready.local_now::date
);
      $cron$
    );
  end if;
end $$;
