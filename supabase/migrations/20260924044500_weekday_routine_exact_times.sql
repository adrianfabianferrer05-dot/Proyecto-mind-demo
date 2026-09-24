-- La rutina laboral tiene dos horas elegidas explícitamente por el usuario.
-- Debe conservarlas aunque el silencio nocturno global desplace otros recordatorios.
-- La preferencia global sigue decidiendo si los recordatorios están habilitados;
-- solo se restaura scheduled_at después del trigger de preferencias cuando la fila
-- de esta rutina ha quedado en estado queued.

create or replace function private.enqueue_weekday_routine(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  routine_id uuid;
  profile jsonb;
  tz text;
  local_now timestamp;
  local_dow smallint;
  morning_time time;
  afternoon_time time;
  moment text;
  push_title text;
  push_body text;
  exact_at timestamptz;
  inserted_id uuid;
  inserted_status text;
begin
  select id, metadata into routine_id, profile
  from public.mind_captures
  where source = 'system_routine'
    and metadata->>'routine_profile' = 'weekday_v1'
    and archived_at is null
    and coalesce((metadata->>'active')::boolean, false)
  order by updated_at desc
  limit 1;

  if routine_id is null then return 0; end if;

  tz := coalesce(nullif(profile->>'timezone',''), 'Europe/Madrid');
  local_now := p_now at time zone tz;
  local_dow := extract(dow from local_now)::smallint;

  if not exists (
    select 1
    from jsonb_array_elements_text(coalesce(profile->'notify_weekdays','[]'::jsonb)) d(value)
    where d.value::smallint = local_dow
  ) then
    return 0;
  end if;

  morning_time := coalesce((profile->>'morning_time')::time, time '06:00');
  afternoon_time := coalesce((profile->>'summary_time')::time, time '15:20');

  if local_now::time >= morning_time and local_now::time < morning_time + interval '2 minutes' then
    moment := 'morning';
    push_title := 'Tu mañana';
    push_body := left(coalesce(nullif(profile->>'morning_push',''), 'Buenos días. Tienes tu rutina de mañana.'), 220);
    exact_at := (local_now::date + morning_time) at time zone tz;
  elsif local_now::time >= afternoon_time and local_now::time < afternoon_time + interval '2 minutes' then
    moment := 'afternoon';
    push_title := 'Tu tarde';
    push_body := left(
      coalesce(nullif(profile->>'afternoon_push',''), 'Tienes tu rutina de la tarde pendiente.')
      || case when local_dow = 5 and nullif(profile->>'friday_push','') is not null
              then ' ' || (profile->>'friday_push') else '' end,
      220
    );
    exact_at := (local_now::date + afternoon_time) at time zone tz;
  else
    return 0;
  end if;

  if exists (
    select 1 from public.notification_queue q
    where q.capture_id = routine_id
      and q.title = push_title
      and (q.scheduled_at at time zone tz)::date = local_now::date
  ) then
    return 0;
  end if;

  insert into public.notification_queue(title, body, target_url, scheduled_at, status, capture_id)
  values (push_title, push_body, '/', exact_at, 'queued', routine_id)
  returning id, status into inserted_id, inserted_status;

  -- apply_notification_preferences() se ejecuta en INSERT. Si las notificaciones
  -- están permitidas, restauramos la hora elegida para esta rutina. Si el trigger
  -- la canceló por preferencias globales, no la reactivamos.
  if inserted_status = 'queued' then
    update public.notification_queue
    set scheduled_at = exact_at,
        updated_at = now()
    where id = inserted_id;
  end if;

  return 1;
end;
$function$;

revoke all on function private.enqueue_weekday_routine(timestamptz) from public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('segunda-mente-weekday-routine')
      where exists (select 1 from cron.job where jobname = 'segunda-mente-weekday-routine');
    perform cron.schedule(
      'segunda-mente-weekday-routine',
      '* * * * *',
      'select private.enqueue_weekday_routine();'
    );
  end if;
end $$;
