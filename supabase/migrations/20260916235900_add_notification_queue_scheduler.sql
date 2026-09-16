create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create table if not exists public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 220),
  target_url text not null default '/' check (target_url like '/%'),
  scheduled_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','dispatching','dispatched','delivered','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  request_id bigint,
  last_error text,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_queue_due_idx
  on public.notification_queue (status, scheduled_at)
  where status = 'queued';

create index if not exists notification_queue_request_idx
  on public.notification_queue (request_id)
  where request_id is not null;

alter table public.notification_queue enable row level security;
revoke all on table public.notification_queue from anon, authenticated;
grant select, insert, update, delete on table public.notification_queue to service_role;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.dispatch_due_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
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
$$;

revoke all on function private.dispatch_due_notifications() from public, anon, authenticated;
grant execute on function private.dispatch_due_notifications() to postgres, service_role;

create or replace function private.reconcile_notification_queue()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
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
$$;

revoke all on function private.reconcile_notification_queue() from public, anon, authenticated;
grant execute on function private.reconcile_notification_queue() to postgres, service_role;

select cron.schedule(
  'segunda-mente-dispatch-notifications',
  '* * * * *',
  'select private.dispatch_due_notifications();'
);

select cron.schedule(
  'segunda-mente-reconcile-notifications',
  '* * * * *',
  'select private.reconcile_notification_queue();'
);
