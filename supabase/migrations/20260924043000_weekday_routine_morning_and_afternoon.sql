-- Dos avisos útiles para la rutina laboral: al levantarse y al terminar el trabajo.
-- La hora se evalúa en Europe/Madrid para respetar automáticamente verano/invierno.

update public.mind_captures
set metadata = metadata || jsonb_build_object(
      'morning_time', '06:00',
      'morning_push', 'Buenos días. Al levantarte: batido de leche + cacahuete en polvo + avena + proteína. Trabajo 07:00–15:20 y almuerzo sobre las 09:00. Esta tarde te recuerdo lo que toca al salir.'
    ),
    updated_at = now()
where source = 'system_routine'
  and metadata->>'routine_profile' = 'weekday_v1'
  and archived_at is null;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('segunda-mente-afternoon-routine')
      where exists (select 1 from cron.job where jobname = 'segunda-mente-afternoon-routine');
    perform cron.unschedule('segunda-mente-weekday-routine')
      where exists (select 1 from cron.job where jobname = 'segunda-mente-weekday-routine');

    perform cron.schedule(
      'segunda-mente-weekday-routine',
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
         coalesce((r.metadata->>'morning_time')::time, time '06:00') as morning_time,
         coalesce((r.metadata->>'summary_time')::time, time '15:20') as afternoon_time
  from routine r
), ready as (
  select d.*,
         case
           when d.local_now::time >= d.morning_time
            and d.local_now::time < d.morning_time + interval '2 minutes' then 'morning'
           when d.local_now::time >= d.afternoon_time
            and d.local_now::time < d.afternoon_time + interval '2 minutes' then 'afternoon'
           else null
         end as moment
  from due d
  where exists (
    select 1
    from jsonb_array_elements_text(coalesce(d.metadata->'notify_weekdays','[]'::jsonb)) x(value)
    where x.value::smallint = d.local_dow
  )
), payload as (
  select *,
         case when moment = 'morning' then 'Tu mañana' else 'Tu tarde' end as push_title,
         case
           when moment = 'morning' then
             left(coalesce(nullif(metadata->>'morning_push',''), 'Buenos días. Tienes tu rutina de mañana.'), 220)
           when moment = 'afternoon' then
             left(
               coalesce(nullif(metadata->>'afternoon_push',''), 'Tienes tu rutina de la tarde pendiente.')
               || case when local_dow = 5 and nullif(metadata->>'friday_push','') is not null
                       then ' ' || (metadata->>'friday_push') else '' end,
               220
             )
         end as push_body
  from ready
  where moment is not null
)
insert into public.notification_queue(title, body, target_url, scheduled_at, status, capture_id)
select push_title, push_body, '/', now(), 'queued', id
from payload p
where not exists (
  select 1
  from public.notification_queue q
  where q.capture_id = p.id
    and q.title = p.push_title
    and (q.scheduled_at at time zone p.tz)::date = p.local_now::date
);
      $cron$
    );
  end if;
end $$;
