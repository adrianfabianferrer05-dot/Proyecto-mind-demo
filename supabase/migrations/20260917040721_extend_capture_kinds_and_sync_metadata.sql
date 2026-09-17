alter table public.mind_captures
  add column if not exists updated_at timestamptz not null default now();

alter table public.mind_captures
  drop constraint if exists mind_captures_kind_check;

alter table public.mind_captures
  add constraint mind_captures_kind_check
  check (kind in ('expense','income','task','idea','note','event','debt'));

create or replace function public.mind_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mind_captures_touch_updated_at on public.mind_captures;
create trigger mind_captures_touch_updated_at
before update on public.mind_captures
for each row execute function public.mind_touch_updated_at();

create index if not exists mind_captures_kind_active_idx
  on public.mind_captures(kind, created_at desc)
  where archived_at is null;

create index if not exists mind_captures_due_idx
  on public.mind_captures(due_at)
  where archived_at is null and completed_at is null and due_at is not null;
