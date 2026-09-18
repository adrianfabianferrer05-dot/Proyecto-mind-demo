-- Preferencias de notificaciones. Una sola fila: Segunda Mente es de una persona.
create table if not exists public.notification_preferences (
  id              smallint primary key default 1 check (id = 1),
  enabled         boolean not null default true,
  tasks           boolean not null default true,
  events          boolean not null default true,
  reminders       boolean not null default true,
  gym             boolean not null default true,
  lead_minutes    integer not null default 0   check (lead_minutes between 0 and 1440),
  quiet_enabled   boolean not null default true,
  quiet_from_hour smallint not null default 23 check (quiet_from_hour between 0 and 23),
  quiet_to_hour   smallint not null default 8  check (quiet_to_hour between 0 and 23),
  updated_at      timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
comment on table public.notification_preferences is
  'Preferencias de aviso. Se aplican en la cola mediante trigger, no en la interfaz, para que valgan venga el aviso de donde venga.';

insert into public.notification_preferences(id) values (1) on conflict (id) do nothing;

-- El aviso se filtra al entrar en la cola, no al enviarse: asi la preferencia vale
-- igual la encole `mind`, `mind-edit` o cualquier cosa que venga despues.
create or replace function private.apply_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

drop trigger if exists apply_notification_preferences on public.notification_queue;
create trigger apply_notification_preferences
  before insert on public.notification_queue
  for each row execute function private.apply_notification_preferences();
