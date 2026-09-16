create table if not exists public.mind_device_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  label text not null default 'iPhone',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null
);

alter table public.mind_device_sessions enable row level security;
revoke all on table public.mind_device_sessions from anon, authenticated;

alter table public.mind_captures
  add column if not exists completed_at timestamptz null,
  add column if not exists archived_at timestamptz null;

create index if not exists mind_captures_active_created_idx
  on public.mind_captures(created_at desc)
  where archived_at is null;

create index if not exists mind_device_sessions_active_idx
  on public.mind_device_sessions(last_seen_at desc)
  where revoked_at is null;
