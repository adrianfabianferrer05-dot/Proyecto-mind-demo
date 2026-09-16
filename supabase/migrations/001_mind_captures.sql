create table if not exists public.mind_captures (
  id uuid primary key default gen_random_uuid(),
  raw_text text not null check (char_length(btrim(raw_text)) between 1 and 4000),
  kind text not null default 'note' check (kind in ('expense','income','task','idea','note')),
  amount numeric(12,2),
  currency text not null default 'EUR',
  category text,
  title text,
  occurred_at timestamptz,
  due_at timestamptz,
  source text not null default 'iphone_shortcut',
  metadata jsonb not null default '{}'::jsonb,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.mind_captures enable row level security;

-- Intentionally no anon/authenticated policies. The iPhone Shortcut never talks
-- to Supabase directly; ingestion is performed by the trusted server endpoint.
create index if not exists mind_captures_created_at_idx
  on public.mind_captures (created_at desc);
create index if not exists mind_captures_kind_idx
  on public.mind_captures (kind);
