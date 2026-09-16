create table if not exists public.mind_captures (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 1 and 4000),
  kind text not null check (kind in ('expense','income','task','idea','note')),
  amount numeric(12,2),
  source text not null default 'iphone_shortcut',
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.mind_captures enable row level security;

-- No anon/authenticated policies on purpose. Captures are written only by the
-- server-side endpoint using the service role. Never expose that key to iPhone.
create index if not exists mind_captures_captured_at_idx
  on public.mind_captures (captured_at desc);
create index if not exists mind_captures_kind_idx
  on public.mind_captures (kind);
