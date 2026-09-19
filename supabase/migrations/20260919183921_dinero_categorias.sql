/* Categorías de gasto para los movimientos del banco.

   Nada de lo que hay se toca: `bank_transactions` conserva sus importes, sus fechas,
   sus identificadores y su `raw`. Lo que se añade son columnas de clasificación, que
   nacen a null y se rellenan aparte. Si mañana la clasificación resulta ser mala, se
   ponen a null otra vez y no se ha perdido un solo movimiento.

   La descripción original tampoco se toca: `merchant_normalized` es una columna nueva
   al lado, no una limpieza en sitio. "MERCADONA BARBASTRO 006297170" sigue estando
   entero para cuando la normalización mejore y haya que rehacerla. */

alter table public.bank_transactions add column if not exists merchant_normalized     text;
alter table public.bank_transactions add column if not exists classification_source   text;
alter table public.bank_transactions add column if not exists classification_confidence numeric(4,3);
alter table public.bank_transactions add column if not exists classified_at           timestamptz;

/* De dónde salió la categoría. No es decoración: es lo que permite saber si el sistema
   acierta, cuánto trabajo hace la IA y qué habría que convertir en regla. */
do $$ begin
  alter table public.bank_transactions add constraint bank_transactions_source_chk
    check (classification_source is null or classification_source in ('rule','learned_rule','ai','manual'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.bank_transactions add constraint bank_transactions_confidence_chk
    check (classification_confidence is null or (classification_confidence >= 0 and classification_confidence <= 1));
exception when duplicate_object then null; end $$;

/* Un gasto apuntado a mano solo puede emparejarse con un movimiento bancario. Sin esto,
   dos movimientos parecidos podrían reclamar la misma captura y el gasto se contaría
   una vez de menos en un sitio y una de más en otro. */
create unique index if not exists bank_transactions_reconciled_uidx
  on public.bank_transactions (reconciled_capture_id) where reconciled_capture_id is not null;

create index if not exists bank_transactions_category_idx  on public.bank_transactions (category);
create index if not exists bank_transactions_merchant_idx  on public.bank_transactions (merchant_normalized);
create index if not exists bank_transactions_booked_idx    on public.bank_transactions (booked_at desc);

/* Las categorías viven en una tabla y no en el código para poder añadir o renombrar sin
   desplegar. El arranque es el de `categorize.js`; a partir de ahí manda esta tabla. */
create table if not exists public.money_categories (
  name       text primary key,
  position   integer not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.money_categories(name, position) values
  ('Alimentación', 10), ('Comer fuera', 20), ('Ocio', 30), ('Transporte', 40),
  ('Compras', 50), ('Suscripciones', 60), ('Hogar', 70), ('Salud', 80),
  ('Gimnasio', 90), ('Viajes', 100), ('Transferencias / Bizum', 110), ('Efectivo', 120),
  ('Ingresos', 130), ('Otros', 140), ('Sin clasificar', 999)
on conflict (name) do nothing;

/* La memoria de correcciones. `match_value` es el comercio ya normalizado y en
   minúsculas: "mercadona", "bizum · kama s.". Único a propósito — una corrección
   sustituye a la anterior en vez de acumularse, que es lo que se espera cuando alguien
   cambia de opinión. `source` distingue lo que decidió una persona de lo que dedujo el
   modelo, y una decisión humana no se pisa nunca con una automática. */
create table if not exists public.bank_category_rules (
  id          uuid primary key default gen_random_uuid(),
  match_value text not null unique,
  category    text not null,
  source      text not null default 'manual' check (source in ('manual','ai')),
  confidence  numeric(4,3) not null default 1.0 check (confidence >= 0 and confidence <= 1),
  reason      text,
  hits        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

/* Gastos que se repiten cada mes. La detección es una inferencia, no un hecho: por eso
   el estado nace en 'possible' y solo una confirmación lo mueve a 'confirmed'. */
create table if not exists public.bank_subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  merchant_normalized text not null unique,
  status              text not null default 'possible' check (status in ('possible','confirmed','ignored')),
  amount              numeric(12,2),
  months              integer not null default 0,
  last_seen           date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.money_categories      enable row level security;
alter table public.bank_category_rules   enable row level security;
alter table public.bank_subscriptions    enable row level security;

comment on column public.bank_transactions.merchant_normalized is
  'Nombre legible del comercio. La descripcion original no se modifica nunca.';
comment on column public.bank_transactions.classification_source is
  'rule | learned_rule | ai | manual. Null significa sin clasificar todavia.';
comment on table public.money_categories is
  'Categorias disponibles. Se siembra desde categorize.js y a partir de ahi manda la tabla.';
comment on table public.bank_category_rules is
  'Memoria de correcciones: comercio normalizado -> categoria. Una fila por comercio.';
comment on table public.bank_subscriptions is
  'Cargos recurrentes detectados. possible es una inferencia, no una suscripcion confirmada.';
