-- Rutina laboral de lunes a viernes y primer programador del resumen de tarde.
-- Esta migracion refleja exactamente el primer paso aplicado en produccion. La
-- siguiente migracion simplifica el programador para no dejar esquema auxiliar.

alter table public.notification_queue
  add column if not exists dedupe_key text;

create unique index if not exists notification_queue_dedupe_key_uidx
  on public.notification_queue (dedupe_key);

update public.mind_captures
set raw_text = 'De lunes a viernes: me levanto sobre las 06:00. Tomo un batido de leche, cacahuete en polvo, avena y proteína. Trabajo de 07:00 a 15:20 y almuerzo sobre las 09:00. Al terminar: ducha en el trabajo o en casa, comida principal y luego adapto la tarde a mi energía: si estoy bien voy al gimnasio; si estoy cansado, siesta y después gimnasio. Después del gimnasio, ducha y algo ligero sin carbohidratos, como cacahuetes o un batido de proteína. Luego dormir. Los viernes además trabajo de camarero de 20:00 a aproximadamente 00:30.',
    title = 'Rutina laboral · lunes a viernes',
    category = 'Rutina',
    processed = true,
    archived_at = null,
    metadata = jsonb_build_object(
      'routine_profile','weekday_v1',
      'active',true,
      'timezone','Europe/Madrid',
      'notify_weekdays',jsonb_build_array(1,2,3,4,5),
      'summary_time','15:20',
      'morning',jsonb_build_array(
        jsonb_build_object('label','Levantarte','time','06:00','approx',true),
        jsonb_build_object('label','Batido','detail','Leche + cacahuete en polvo + avena + proteína'),
        jsonb_build_object('label','Trabajo','start','07:00','end','15:20'),
        jsonb_build_object('label','Almuerzo','time','09:00','approx',true)
      ),
      'afternoon',jsonb_build_array(
        'Ducha (en el trabajo o en casa)',
        'Comida principal',
        'Si tienes energía: gimnasio',
        'Si estás cansado: siesta y después gimnasio',
        'Ducha después del gimnasio',
        'Algo ligero sin carbohidratos (cacahuetes, batido de proteína, etc.)',
        'Dormir'
      ),
      'afternoon_push','Al salir: ducha + comida. Si vas bien, gym; si estás cansado, siesta y luego gym. Después: ducha + algo ligero sin carbohidratos.',
      'friday_extra',jsonb_build_object('label','Camarero','start','20:00','end','00:30','approx_end',true),
      'friday_push','Esta noche también tienes camarero de 20:00 a ~00:30.'
    ),
    updated_at = now()
where id = (
  select id from public.mind_captures
  where source = 'system_routine'
    and metadata->>'routine_profile' = 'weekday_v1'
  order by created_at desc
  limit 1
);

insert into public.mind_captures(raw_text, kind, category, title, source, metadata, processed)
select
  'De lunes a viernes: me levanto sobre las 06:00. Tomo un batido de leche, cacahuete en polvo, avena y proteína. Trabajo de 07:00 a 15:20 y almuerzo sobre las 09:00. Al terminar: ducha en el trabajo o en casa, comida principal y luego adapto la tarde a mi energía: si estoy bien voy al gimnasio; si estoy cansado, siesta y después gimnasio. Después del gimnasio, ducha y algo ligero sin carbohidratos, como cacahuetes o un batido de proteína. Luego dormir. Los viernes además trabajo de camarero de 20:00 a aproximadamente 00:30.',
  'note',
  'Rutina',
  'Rutina laboral · lunes a viernes',
  'system_routine',
  jsonb_build_object(
    'routine_profile','weekday_v1',
    'active',true,
    'timezone','Europe/Madrid',
    'notify_weekdays',jsonb_build_array(1,2,3,4,5),
    'summary_time','15:20',
    'morning',jsonb_build_array(
      jsonb_build_object('label','Levantarte','time','06:00','approx',true),
      jsonb_build_object('label','Batido','detail','Leche + cacahuete en polvo + avena + proteína'),
      jsonb_build_object('label','Trabajo','start','07:00','end','15:20'),
      jsonb_build_object('label','Almuerzo','time','09:00','approx',true)
    ),
    'afternoon',jsonb_build_array(
      'Ducha (en el trabajo o en casa)',
      'Comida principal',
      'Si tienes energía: gimnasio',
      'Si estás cansado: siesta y después gimnasio',
      'Ducha después del gimnasio',
      'Algo ligero sin carbohidratos (cacahuetes, batido de proteína, etc.)',
      'Dormir'
    ),
    'afternoon_push','Al salir: ducha + comida. Si vas bien, gym; si estás cansado, siesta y luego gym. Después: ducha + algo ligero sin carbohidratos.',
    'friday_extra',jsonb_build_object('label','Camarero','start','20:00','end','00:30','approx_end',true),
    'friday_push','Esta noche también tienes camarero de 20:00 a ~00:30.'
  ),
  true
where not exists (
  select 1 from public.mind_captures
  where source = 'system_routine'
    and metadata->>'routine_profile' = 'weekday_v1'
    and archived_at is null
);

create or replace function private.enqueue_afternoon_routine_summary(p_now timestamptz default now())
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
  summary_time time;
  scheduled timestamptz;
  body_text text;
  friday_text text;
  key_text text;
  inserted_count integer := 0;
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

  begin
    summary_time := (profile->>'summary_time')::time;
  exception when others then
    summary_time := time '15:20';
  end;

  if local_now::time < summary_time
     or local_now::time >= summary_time + interval '2 minutes' then
    return 0;
  end if;

  body_text := coalesce(nullif(profile->>'afternoon_push',''), 'Tienes tu rutina de la tarde pendiente.');
  friday_text := nullif(profile->>'friday_push','');
  if local_dow = 5 and friday_text is not null then
    body_text := left(body_text || ' ' || friday_text, 220);
  else
    body_text := left(body_text, 220);
  end if;

  scheduled := (local_now::date + summary_time) at time zone tz;
  key_text := 'routine:weekday_v1:' || local_now::date::text;

  insert into public.notification_queue(title, body, target_url, scheduled_at, status, capture_id, dedupe_key)
  values ('Tu tarde', body_text, '/', scheduled, 'queued', routine_id, key_text)
  on conflict (dedupe_key) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    update public.notification_queue
    set scheduled_at = scheduled, updated_at = now()
    where dedupe_key = key_text;
  end if;

  return inserted_count;
end;
$function$;

revoke all on function private.enqueue_afternoon_routine_summary(timestamptz) from public;

-- Se revisa cada minuto para respetar Europe/Madrid incluso al cambiar DST.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('segunda-mente-afternoon-routine')
      where exists (select 1 from cron.job where jobname = 'segunda-mente-afternoon-routine');
    perform cron.schedule(
      'segunda-mente-afternoon-routine',
      '* * * * *',
      'select private.enqueue_afternoon_routine_summary();'
    );
  end if;
end $$;
