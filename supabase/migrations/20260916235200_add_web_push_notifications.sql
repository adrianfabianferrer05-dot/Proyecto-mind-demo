create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text,
  active boolean not null default true,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_active_idx
  on public.push_subscriptions (active, updated_at desc);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

create table if not exists public.push_activation_codes (
  code_hash text primary key,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.push_activation_codes enable row level security;
revoke all on table public.push_activation_codes from anon, authenticated;
grant select, insert, update, delete on table public.push_activation_codes to service_role;

create table if not exists public.notification_log (
  id bigint generated always as identity primary key,
  kind text not null default 'web_push',
  title text not null,
  body text not null,
  target_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.notification_log enable row level security;
revoke all on table public.notification_log from anon, authenticated;
grant select, insert on table public.notification_log to service_role;

create extension if not exists pg_net with schema extensions;
