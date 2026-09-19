-- ============================================================================
-- BASELINE. Todo el esquema de Segunda Mente en un solo fichero.
--
-- Por que una baseline y no treinta migraciones:
--
-- En produccion habia 30 migraciones aplicadas y en el repositorio 5 ficheros.
-- Las 25 que faltaban no se pueden reconstruir honestamente: hay nombres
-- repetidos (`personal_app_device_access` dos veces, `index_gym_sessions_day`
-- dos veces), varias de nueve caracteres que no hacen nada, y columnas que se
-- anadieron y se quitaron. Reescribirlas seria inventar una cronologia que
-- nunca existio, y una cronologia inventada es peor que no tenerla: parece
-- historia y no lo es.
--
-- Lo que hace falta de verdad es que una instalacion limpia levante el esquema
-- que hay hoy en produccion. Eso es esto: una captura del estado real,
-- introspeccionada de la base de datos y verificada aplicandola contra un
-- Postgres vacio y comparando tabla por tabla, columna por columna, constraint
-- por constraint, indice por indice, trigger por trigger y funcion por funcion.
-- El procedimiento esta en `scripts/schema-check.mjs` y se puede repetir.
--
-- La version del fichero (20260916181839) es la de la primera migracion
-- historica, que ya consta como aplicada en produccion. Asi un `db push` nunca
-- intenta ejecutar esto contra la base que ya existe: para produccion es
-- historia ya aplicada, y para una instalacion limpia es el punto de partida.
-- Es la forma estandar de aplanar migraciones (`supabase migration squash`).
--
-- A partir de aqui, cada cambio de esquema es un fichero nuevo con su fecha.
-- ============================================================================

-- ─── Extensiones ────────────────────────────────────────────────────────────
-- En un proyecto Supabase vienen instaladas; se declaran igualmente para que
-- una instalacion desde cero sepa que hacen falta.
create schema if not exists extensions;
create extension if not exists pgcrypto      with schema extensions;
create extension if not exists "uuid-ossp"   with schema extensions;
create extension if not exists pg_net        with schema extensions;
create extension if not exists pg_cron;

-- `private` guarda lo que nunca debe ser accesible desde la API: las funciones
-- que despachan avisos y emiten codigos de activacion.
create schema if not exists private;

-- ─── Capturas: el corazon de la app ─────────────────────────────────────────
create table if not exists public.mind_captures (
  id           uuid primary key default gen_random_uuid(),
  raw_text     text not null check (char_length(btrim(raw_text)) > 0),
  kind         text not null default 'note'
               check (kind in ('expense','income','task','idea','note','event','debt')),
  amount       numeric(12,2),
  currency     text not null default 'EUR',
  category     text,
  title        text,
  occurred_at  timestamptz,
  due_at       timestamptz,
  source       text not null default 'iphone_shortcut',
  metadata     jsonb not null default '{}'::jsonb,
  processed    boolean not null default false,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  archived_at  timestamptz,
  updated_at   timestamptz not null default now()
);

-- ─── Dispositivos y sesiones ────────────────────────────────────────────────
-- `mind_device_sessions` es la que usa la app hoy: el token nunca se guarda,
-- solo su sha256. `mind_devices` es anterior y la sigue usando el flujo de push.
create table if not exists public.mind_device_sessions (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  label        text not null default 'iPhone',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz
);

create table if not exists public.mind_devices (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique check (length(token_hash) = 64),
  label        text not null default 'iPhone',
  active       boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─── Avisos ─────────────────────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  endpoint        text not null unique,
  subscription    jsonb not null,
  user_agent      text,
  active          boolean not null default true,
  failure_count   integer not null default 0 check (failure_count >= 0),
  last_success_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  device_id       uuid references public.mind_devices(id) on delete set null
);

create table if not exists public.push_activation_codes (
  code_hash  text primary key,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_log (
  id            bigint generated always as identity primary key,
  kind          text not null default 'web_push',
  title         text not null,
  body          text not null,
  target_count  integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.notification_queue (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 80),
  body          text not null check (char_length(body) between 1 and 220),
  target_url    text not null default '/' check (target_url like '/%'),
  scheduled_at  timestamptz not null,
  status        text not null default 'queued'
                check (status in ('queued','dispatching','dispatched','delivered','failed','cancelled')),
  attempts      integer not null default 0 check (attempts >= 0),
  request_id    bigint,
  last_error    text,
  dispatched_at timestamptz,
  delivered_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  capture_id    uuid references public.mind_captures(id) on delete cascade
);

-- Una sola fila: Segunda Mente es de una persona.
create table if not exists public.notification_preferences (
  id              smallint primary key default 1 check (id = 1),
  enabled         boolean not null default true,
  tasks           boolean not null default true,
  events          boolean not null default true,
  reminders       boolean not null default true,
  lead_minutes    integer not null default 0   check (lead_minutes between 0 and 1440),
  quiet_enabled   boolean not null default true,
  quiet_from_hour smallint not null default 23 check (quiet_from_hour between 0 and 23),
  quiet_to_hour   smallint not null default 8  check (quiet_to_hour between 0 and 23),
  updated_at      timestamptz not null default now()
);

-- ─── Gym ────────────────────────────────────────────────────────────────────
create table if not exists public.gym_routines (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Mi rutina',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gym_days (
  id         uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.gym_routines(id) on delete cascade,
  name       text not null,
  position   integer not null default 0,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gym_exercises (
  id                uuid primary key default gen_random_uuid(),
  day_id            uuid not null references public.gym_days(id) on delete cascade,
  name              text not null,
  position          integer not null default 0,
  target_sets       smallint not null default 3   check (target_sets between 1 and 12),
  rep_min           smallint not null default 6   check (rep_min between 1 and 100),
  rep_max           smallint not null default 12,
  rest_seconds      integer not null default 120  check (rest_seconds between 0 and 1200),
  increment_kg      numeric(6,2) not null default 2.5 check (increment_kg > 0 and increment_kg <= 100),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  planned_weight_kg numeric(7,2) check (planned_weight_kg is null or planned_weight_kg >= 0),
  working_weight_kg numeric(8,2) check (working_weight_kg is null or working_weight_kg >= 0),
  check (rep_max >= rep_min and rep_max <= 100)
);

create table if not exists public.gym_sessions (
  id                uuid primary key default gen_random_uuid(),
  day_id            uuid references public.gym_days(id) on delete set null,
  day_name_snapshot text not null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  bodyweight_kg     numeric(6,2) check (bodyweight_kg is null or (bodyweight_kg >= 20 and bodyweight_kg <= 400)),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.gym_sets (
  id                     uuid primary key default gen_random_uuid(),
  session_id             uuid not null references public.gym_sessions(id) on delete cascade,
  exercise_id            uuid references public.gym_exercises(id) on delete set null,
  exercise_name_snapshot text not null,
  set_number             smallint not null check (set_number between 1 and 50),
  weight_kg              numeric(7,2) not null default 0 check (weight_kg >= 0 and weight_kg <= 1000),
  reps                   smallint not null check (reps between 0 and 200),
  rpe                    numeric(3,1) check (rpe is null or (rpe >= 1 and rpe <= 10)),
  is_warmup              boolean not null default false,
  completed_at           timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

create table if not exists public.gym_body_log (
  id          uuid primary key default gen_random_uuid(),
  measured_at timestamptz not null default now(),
  weight_kg   numeric(6,2) not null check (weight_kg >= 20 and weight_kg <= 400),
  note        text,
  created_at  timestamptz not null default now()
);

-- Rutina semanal: que entrenamiento toca cada dia. Siempre siete filas, para
-- que el descanso sea una eleccion (day_id nulo) y no la ausencia de una fila.
-- weekday usa la numeracion de JavaScript: 0 = domingo.
create table if not exists public.gym_schedule (
  weekday    smallint primary key check (weekday between 0 and 6),
  day_id     uuid references public.gym_days(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ─── Banco (Enable Banking / PSD2) ──────────────────────────────────────────
create table if not exists public.bank_connections (
  id                     uuid primary key default gen_random_uuid(),
  device_session_id      uuid not null references public.mind_device_sessions(id) on delete cascade,
  provider               text not null default 'gocardless',
  institution_id         text not null,
  institution_name       text,
  requisition_id         text unique,
  status                 text not null default 'created',
  provider_accounts      jsonb not null default '[]'::jsonb,
  consent_expires_at     timestamptz,
  last_synced_at         timestamptz,
  revoked_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  balance_synced_at      timestamptz,
  transactions_synced_at timestamptz,
  sync_error             text
);

create table if not exists public.bank_accounts (
  id                  uuid primary key default gen_random_uuid(),
  connection_id       uuid not null references public.bank_connections(id) on delete cascade,
  provider_account_id text not null,
  display_name        text,
  iban_last4          text,
  currency            text,
  owner_name          text,
  current_balance     numeric,
  available_balance   numeric,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  balance_source      text,
  balance_as_of       timestamptz,
  unique (connection_id, provider_account_id)
);

create table if not exists public.bank_transactions (
  id                      uuid primary key default gen_random_uuid(),
  bank_account_id         uuid not null references public.bank_accounts(id) on delete cascade,
  provider_transaction_id text not null,
  booked_at               timestamptz,
  value_date              date,
  amount                  numeric not null,
  currency                text not null default 'EUR',
  merchant                text,
  description             text,
  category                text,
  raw                     jsonb not null default '{}'::jsonb,
  reconciled_capture_id   uuid references public.mind_captures(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (bank_account_id, provider_transaction_id)
);

create table if not exists public.bank_setup_events (
  id                bigserial primary key,
  device_session_id uuid references public.mind_device_sessions(id) on delete cascade,
  stage             text not null,
  detail            text,
  http_status       integer,
  created_at        timestamptz not null default now()
);

-- ─── Indices ────────────────────────────────────────────────────────────────
create index if not exists mind_captures_created_at_idx      on public.mind_captures (created_at desc);
create index if not exists mind_captures_kind_idx            on public.mind_captures (kind);
create index if not exists mind_captures_active_created_idx  on public.mind_captures (created_at desc) where archived_at is null;
create index if not exists mind_captures_kind_active_idx     on public.mind_captures (kind, created_at desc) where archived_at is null;
create index if not exists mind_captures_due_idx             on public.mind_captures (due_at)
  where archived_at is null and completed_at is null and due_at is not null;

create index if not exists mind_device_sessions_active_idx on public.mind_device_sessions (last_seen_at desc) where revoked_at is null;
create index if not exists mind_devices_active_idx         on public.mind_devices (active, updated_at desc);

create index if not exists push_subscriptions_active_idx on public.push_subscriptions (active, updated_at desc);
create index if not exists push_subscriptions_device_idx on public.push_subscriptions (device_id) where device_id is not null;

create index if not exists notification_queue_due_idx     on public.notification_queue (status, scheduled_at) where status = 'queued';
create index if not exists notification_queue_request_idx on public.notification_queue (request_id) where request_id is not null;
create index if not exists notification_queue_capture_idx on public.notification_queue (capture_id) where capture_id is not null;

create index if not exists gym_days_routine_position_idx  on public.gym_days (routine_id, "position");
create index if not exists gym_exercises_day_position_idx on public.gym_exercises (day_id, "position");
create index if not exists gym_exercises_planned_weight_idx on public.gym_exercises (planned_weight_kg) where planned_weight_kg is not null;
create index if not exists gym_sessions_started_idx       on public.gym_sessions (started_at desc);
create index if not exists gym_sessions_open_idx          on public.gym_sessions (finished_at) where finished_at is null;
create index if not exists gym_sessions_day_idx           on public.gym_sessions (day_id);
create index if not exists gym_sets_session_idx           on public.gym_sets (session_id, completed_at);
create index if not exists gym_sets_exercise_idx          on public.gym_sets (exercise_id, completed_at desc);
create index if not exists gym_sets_exercise_completed_idx on public.gym_sets (exercise_id, completed_at desc) where exercise_id is not null;
create index if not exists gym_body_log_measured_idx      on public.gym_body_log (measured_at desc);
create index if not exists gym_schedule_day_idx           on public.gym_schedule (day_id);

create index if not exists bank_connections_device_idx         on public.bank_connections (device_session_id, created_at desc);
create index if not exists bank_connections_status_idx         on public.bank_connections (status) where revoked_at is null;
create index if not exists bank_connections_status_created_idx on public.bank_connections (provider, status, created_at desc);
create index if not exists bank_accounts_connection_idx        on public.bank_accounts (connection_id);
create index if not exists bank_transactions_account_date_idx  on public.bank_transactions (bank_account_id, booked_at desc);
create index if not exists bank_transactions_reconciled_capture_idx on public.bank_transactions (reconciled_capture_id) where reconciled_capture_id is not null;
create index if not exists bank_transactions_unreconciled_idx  on public.bank_transactions (booked_at desc) where reconciled_capture_id is null;
create index if not exists bank_setup_events_created_idx       on public.bank_setup_events (created_at desc);

-- ─── Funciones ──────────────────────────────────────────────────────────────
create or replace function public.mind_touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.touch_gym_exercise_updated_at()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$ begin new.updated_at = now(); return new; end $function$;

-- El dictado del iPhone escribe "a las 18 30"; aqui se convierte en "a las 18:30"
-- para que lo que se lee coincida con lo que se entendio.
create or replace function public.mind_normalize_spoken_time_title()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.title is null or btrim(new.title) = '' then
    new.title := new.raw_text;
  end if;

  new.title := regexp_replace(
    new.title,
    '((a las|a la|sobre las)[[:space:]]+)([01]?[0-9]|2[0-3])[[:space:]]+([0-5][0-9])',
    '\1\3:\4',
    'gi'
  );
  return new;
end;
$function$;

-- El aviso se filtra al ENTRAR en la cola, no al enviarse: asi la preferencia
-- vale igual la encole `mind`, `mind-edit`, el atajo o lo que venga despues.
create or replace function private.apply_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  p public.notification_preferences%rowtype;
  capture_kind text;
  allowed boolean := true;
  local_ts timestamp;
  local_hour smallint;
  in_quiet boolean;
begin
  select * into p from public.notification_preferences where id = 1;
  if not found then
    return new;                      -- sin preferencias configuradas, no se filtra nada
  end if;

  if not p.enabled then
    new.status := 'cancelled';
    new.last_error := 'suppressed_by_preferences:global';
    return new;
  end if;

  select kind into capture_kind from public.mind_captures where id = new.capture_id;

  if capture_kind = 'task' then
    allowed := p.tasks;
  elsif capture_kind = 'event' then
    allowed := p.events;
  elsif capture_kind is null then
    allowed := p.reminders;          -- avisos que no cuelgan de una captura
  else
    allowed := p.reminders;
  end if;

  if not allowed then
    new.status := 'cancelled';
    new.last_error := 'suppressed_by_preferences:' || coalesce(capture_kind, 'reminder');
    return new;
  end if;

  -- Antelacion: avisar antes de la hora, nunca en el pasado.
  if p.lead_minutes > 0 then
    new.scheduled_at := greatest(new.scheduled_at - make_interval(mins => p.lead_minutes), now());
  end if;

  -- Silencio nocturno en hora de Madrid. Un aviso dentro de la franja se corre a
  -- la hora de salida, en vez de perderse.
  if p.quiet_enabled then
    local_ts := new.scheduled_at at time zone 'Europe/Madrid';
    local_hour := extract(hour from local_ts)::smallint;
    if p.quiet_from_hour > p.quiet_to_hour then
      in_quiet := local_hour >= p.quiet_from_hour or local_hour < p.quiet_to_hour;
    elsif p.quiet_from_hour < p.quiet_to_hour then
      in_quiet := local_hour >= p.quiet_from_hour and local_hour < p.quiet_to_hour;
    else
      in_quiet := false;             -- franja vacia: no silencia nada
    end if;

    if in_quiet then
      if p.quiet_from_hour > p.quiet_to_hour and local_hour >= p.quiet_from_hour then
        local_ts := date_trunc('day', local_ts) + interval '1 day' + make_interval(hours => p.quiet_to_hour);
      else
        local_ts := date_trunc('day', local_ts) + make_interval(hours => p.quiet_to_hour);
      end if;
      new.scheduled_at := local_ts at time zone 'Europe/Madrid';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function private.issue_push_activation_code(ttl_minutes integer default 20)
returns table(code text, expires_at timestamptz)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  raw_code text;
  expiry timestamptz;
begin
  if ttl_minutes < 1 or ttl_minutes > 60 then
    raise exception 'ttl_minutes_out_of_range';
  end if;

  raw_code := upper(
    substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 4) || '-' ||
    substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 4) || '-' ||
    substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 4)
  );
  expiry := now() + make_interval(mins => ttl_minutes);

  insert into public.push_activation_codes(code_hash, expires_at)
  values (encode(extensions.digest(raw_code, 'sha256'), 'hex'), expiry);

  return query select raw_code, expiry;
end;
$function$;

-- Saca de la cola lo que ya toca y se lo pasa a la Edge Function de push.
-- El token de envio vive en el Vault, nunca en el codigo.
create or replace function private.dispatch_due_notifications()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  item record;
  sender_token text;
  req_id bigint;
  dispatched_count integer := 0;
begin
  select decrypted_secret into sender_token
  from vault.decrypted_secrets
  where name = 'segunda_mente_push_send_token'
  limit 1;

  if sender_token is null then
    raise exception 'push sender token missing';
  end if;

  for item in
    select id, title, body, target_url
    from public.notification_queue
    where status = 'queued'
      and scheduled_at <= now()
    order by scheduled_at asc
    limit 20
    for update skip locked
  loop
    update public.notification_queue
    set status = 'dispatching', attempts = attempts + 1, updated_at = now()
    where id = item.id;

    select net.http_post(
      url := 'https://dabzmzwnvzoeywyflkoo.supabase.co/functions/v1/push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || sender_token
      ),
      body := jsonb_build_object(
        'action', 'send',
        'title', item.title,
        'body', item.body,
        'url', item.target_url
      ),
      timeout_milliseconds := 5000
    ) into req_id;

    update public.notification_queue
    set status = 'dispatched', request_id = req_id, dispatched_at = now(), updated_at = now()
    where id = item.id;

    dispatched_count := dispatched_count + 1;
  end loop;

  return dispatched_count;
end;
$function$;

-- Un aviso despachado no esta entregado: aqui se lee la respuesta real del push
-- y se reintenta o se da por fallido, en vez de suponer que salio bien.
create or replace function private.reconcile_notification_queue()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  item record;
  response record;
  reconciled_count integer := 0;
  response_json jsonb;
  push_success integer;
begin
  for item in
    select id, request_id, attempts, dispatched_at
    from public.notification_queue
    where status = 'dispatched'
      and request_id is not null
    order by dispatched_at asc
    limit 50
    for update skip locked
  loop
    select status_code, content, error_msg, timed_out
      into response
    from net._http_response
    where id = item.request_id
    order by created desc
    limit 1;

    if found then
      if response.status_code between 200 and 299 and response.error_msg is null and coalesce(response.timed_out,false) = false then
        begin
          response_json := response.content::jsonb;
          push_success := coalesce((response_json->>'success')::integer, 0);
        exception when others then
          push_success := 0;
        end;

        if push_success > 0 then
          update public.notification_queue
          set status = 'delivered', delivered_at = now(), last_error = null, updated_at = now()
          where id = item.id;
        elsif item.attempts < 3 then
          update public.notification_queue
          set status = 'queued', scheduled_at = now() + interval '2 minutes', request_id = null,
              last_error = 'push endpoint reported zero successful deliveries', updated_at = now()
          where id = item.id;
        else
          update public.notification_queue
          set status = 'failed', last_error = 'push endpoint reported zero successful deliveries', updated_at = now()
          where id = item.id;
        end if;
      elsif item.attempts < 3 then
        update public.notification_queue
        set status = 'queued', scheduled_at = now() + interval '2 minutes', request_id = null,
            last_error = left(coalesce(response.error_msg, 'HTTP ' || coalesce(response.status_code::text,'unknown')), 500), updated_at = now()
        where id = item.id;
      else
        update public.notification_queue
        set status = 'failed',
            last_error = left(coalesce(response.error_msg, 'HTTP ' || coalesce(response.status_code::text,'unknown')), 500), updated_at = now()
        where id = item.id;
      end if;
      reconciled_count := reconciled_count + 1;
    elsif item.dispatched_at < now() - interval '5 minutes' then
      if item.attempts < 3 then
        update public.notification_queue
        set status = 'queued', scheduled_at = now() + interval '2 minutes', request_id = null,
            last_error = 'push response timeout', updated_at = now()
        where id = item.id;
      else
        update public.notification_queue
        set status = 'failed', last_error = 'push response timeout after retries', updated_at = now()
        where id = item.id;
      end if;
      reconciled_count := reconciled_count + 1;
    end if;
  end loop;

  return reconciled_count;
end;
$function$;

-- ─── Triggers ───────────────────────────────────────────────────────────────
drop trigger if exists mind_captures_touch_updated_at on public.mind_captures;
create trigger mind_captures_touch_updated_at
  before update on public.mind_captures
  for each row execute function public.mind_touch_updated_at();

drop trigger if exists mind_normalize_spoken_time_title_trg on public.mind_captures;
create trigger mind_normalize_spoken_time_title_trg
  before insert or update of raw_text, title on public.mind_captures
  for each row execute function public.mind_normalize_spoken_time_title();

drop trigger if exists gym_exercises_touch_updated_at on public.gym_exercises;
create trigger gym_exercises_touch_updated_at
  before update on public.gym_exercises
  for each row execute function public.touch_gym_exercise_updated_at();

drop trigger if exists apply_notification_preferences on public.notification_queue;
create trigger apply_notification_preferences
  before insert on public.notification_queue
  for each row execute function private.apply_notification_preferences();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- RLS activado y CERO politicas, a proposito: desde PostgREST no se puede leer
-- ni escribir nada. Todo el acceso pasa por Edge Functions que se conectan con
-- SUPABASE_DB_URL. El navegador no lleva anon key ni supabase-js.
alter table public.mind_captures            enable row level security;
alter table public.mind_device_sessions     enable row level security;
alter table public.mind_devices             enable row level security;
alter table public.push_subscriptions       enable row level security;
alter table public.push_activation_codes    enable row level security;
alter table public.notification_log         enable row level security;
alter table public.notification_queue       enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.gym_routines             enable row level security;
alter table public.gym_days                 enable row level security;
alter table public.gym_exercises            enable row level security;
alter table public.gym_sessions             enable row level security;
alter table public.gym_sets                 enable row level security;
alter table public.gym_body_log             enable row level security;
alter table public.gym_schedule             enable row level security;
alter table public.bank_connections         enable row level security;
alter table public.bank_accounts            enable row level security;
alter table public.bank_transactions        enable row level security;
alter table public.bank_setup_events        enable row level security;

-- ─── Filas que tienen que existir ───────────────────────────────────────────
insert into public.notification_preferences(id) values (1) on conflict (id) do nothing;
insert into public.gym_schedule(weekday) select generate_series(0, 6) on conflict (weekday) do nothing;

comment on table public.notification_preferences is
  'Preferencias de aviso. Se aplican en la cola mediante trigger, no en la interfaz, para que valgan venga el aviso de donde venga.';
comment on table public.gym_schedule is
  'Rutina semanal: que dia de entrenamiento toca cada dia de la semana. day_id nulo = descanso. weekday 0 = domingo (numeracion de JavaScript).';

-- ─── Tareas programadas ─────────────────────────────────────────────────────
-- Cada minuto: sacar lo que toca y comprobar si de verdad llego.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('segunda-mente-dispatch-notifications')
      where exists (select 1 from cron.job where jobname = 'segunda-mente-dispatch-notifications');
    perform cron.unschedule('segunda-mente-reconcile-notifications')
      where exists (select 1 from cron.job where jobname = 'segunda-mente-reconcile-notifications');
    perform cron.schedule('segunda-mente-dispatch-notifications', '* * * * *', 'select private.dispatch_due_notifications();');
    perform cron.schedule('segunda-mente-reconcile-notifications', '* * * * *', 'select private.reconcile_notification_queue();');
  end if;
end $$;
