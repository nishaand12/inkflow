create extension if not exists "pgcrypto";

create table if not exists studios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hq_location text,
  phone text,
  studio_email text,
  currency text default 'USD',
  invite_code text unique,
  is_active boolean default false,
  owner_id uuid,
  timezone text default 'UTC',
  subscription_tier text default 'basic',
  email_reminders_enabled boolean default false,
  reminder_minutes_before integer default 1440,
  stripe_account_id text,
  stripe_onboarding_complete boolean default false,
  stripe_charges_enabled boolean default false,
  stripe_payouts_enabled boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  user_role text default 'Artist',
  studio_id uuid references studios (id),
  is_onboarded boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  name text not null,
  address text not null,
  city text not null,
  phone text,
  email text,
  station_capacity integer default 8,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists artists (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  user_id uuid references users (id),
  full_name text not null,
  artist_type text not null default 'tattoo',
  calendar_color text,
  specialty text,
  bio text,
  phone text,
  instagram text,
  hourly_rate numeric,
  primary_location_id uuid references locations (id),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists artist_locations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  artist_id uuid references artists (id),
  location_id uuid references locations (id),
  days_available text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists availabilities (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  artist_id uuid references artists (id),
  location_id uuid references locations (id),
  start_date date not null,
  end_date date not null,
  start_time text not null,
  end_time text not null,
  is_blocked boolean default false,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists workstations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  location_id uuid references locations (id),
  name text not null,
  status text default 'active',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  name text not null,
  phone_number text not null,
  email text,
  instagram_username text,
  preferred_location_id uuid references locations (id),
  send_calendar_invites boolean default false,
  consent_obtained boolean default false,
  email_bounced boolean default false,
  email_bounce_reason text,
  email_bounced_at timestamptz,
  email_unsubscribed boolean default false,
  email_unsubscribed_at timestamptz,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists reporting_categories (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  name text not null,
  category_type text not null default 'item',
  display_order integer default 0,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists reporting_categories_studio_idx on reporting_categories(studio_id);

create table if not exists appointment_types (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  category text not null,
  name text not null,
  description text,
  default_duration_minutes integer not null,
  default_deposit numeric not null,
  service_cost numeric,
  is_active boolean default true,
  is_public_bookable boolean default false,
  reporting_category_id uuid references reporting_categories (id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  artist_id uuid references artists (id),
  location_id uuid references locations (id),
  work_station_id uuid references workstations (id),
  customer_id uuid references customers (id),
  appointment_type_id uuid references appointment_types (id),
  client_name text,
  client_email text,
  client_phone text,
  appointment_date date not null,
  start_time text not null,
  end_time text not null,
  deposit_amount numeric,
  total_estimate numeric,
  charge_amount numeric,
  tax_amount numeric,
  payment_method text,
  design_description text,
  placement text,
  notes text,
  invitees jsonb,
  deposit_status text default 'none',
  discount_amount numeric default 0,
  health_fields jsonb default '{}',
  status text default 'scheduled',
  email_send_status text default 'pending',
  email_send_failed_reason text,
  email_sent_at timestamptz,
  reminder_sent_week boolean default false,
  reminder_sent_day boolean default false,
  reminder_sent_at timestamptz,
  reminder_minutes_before integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios(id),
  appointment_id uuid references appointments(id),
  customer_id uuid references customers(id),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  amount numeric not null,
  currency text default 'USD',
  status text default 'pending',
  payment_type text default 'deposit',
  checkout_url text,
  paid_at timestamptz,
  expires_at timestamptz,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists payments_appointment_idx on payments(appointment_id);
create index if not exists payments_studio_idx on payments(studio_id);
create index if not exists payments_stripe_session_idx on payments(stripe_checkout_session_id);

create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  customer_id uuid references customers (id),
  appointment_id uuid references appointments (id),
  email text not null,
  event_type text not null,
  reason text,
  occurred_at timestamptz default now(),
  metadata jsonb
);

create index if not exists email_events_email_idx on email_events (email);
create index if not exists email_events_appointment_idx on email_events (appointment_id);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  reporting_category_id uuid references reporting_categories (id),
  name text not null,
  supplier_name text,
  supplier_sku text,
  sku text,
  barcode text,
  price numeric not null default 0,
  cost numeric,
  stock_quantity integer,
  tax_rate numeric not null default 0.13,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists products_studio_idx on products(studio_id);
create index if not exists products_barcode_idx on products(studio_id, barcode);
create index if not exists products_sku_idx on products(studio_id, sku);

create table if not exists appointment_charges (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  appointment_id uuid references appointments (id) on delete cascade,
  line_type text not null default 'product',
  reporting_category_id uuid references reporting_categories (id),
  reporting_category_name text,
  product_id uuid references products (id),
  description text not null,
  quantity integer not null default 1,
  unit_price numeric not null default 0,
  discount_amount numeric not null default 0,
  line_total numeric not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists appointment_charges_appointment_idx on appointment_charges(appointment_id);
create index if not exists appointment_charges_studio_idx on appointment_charges(studio_id);

create table if not exists appointment_refunds (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios (id),
  appointment_id uuid not null references appointments (id) on delete cascade,
  amount numeric not null check (amount > 0),
  refund_method text not null check (refund_method in ('card', 'cash', 'store_credit')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists appointment_refunds_studio_idx on appointment_refunds (studio_id);
create index if not exists appointment_refunds_appointment_idx on appointment_refunds (appointment_id);

create table if not exists artist_split_rules (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  artist_id uuid references artists (id),
  split_percent numeric not null default 50,
  eligible_category_ids uuid[] default '{}',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists artist_split_rules_studio_idx on artist_split_rules(studio_id);
create index if not exists artist_split_rules_artist_idx on artist_split_rules(artist_id);

create table if not exists daily_settlements (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  location_id uuid references locations (id),
  settlement_date date not null,
  status text not null default 'draft',
  gross_total numeric not null default 0,
  tax_total numeric not null default 0,
  discount_total numeric not null default 0,
  net_total numeric not null default 0,
  pos_collected numeric not null default 0,
  online_collected numeric not null default 0,
  gift_card_sales numeric not null default 0,
  gift_card_returns numeric not null default 0,
  locked_at timestamptz,
  locked_by uuid references users (id),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists daily_settlements_unique_idx
  on daily_settlements(studio_id, location_id, settlement_date);
create index if not exists daily_settlements_studio_date_idx
  on daily_settlements(studio_id, settlement_date);

create table if not exists daily_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  settlement_id uuid references daily_settlements (id) on delete cascade,
  artist_id uuid references artists (id),
  appointment_id uuid references appointments (id),
  gross_amount numeric not null default 0,
  artist_share numeric not null default 0,
  shop_share numeric not null default 0,
  split_percent numeric not null default 0,
  created_at timestamptz default now()
);

create index if not exists daily_settlement_lines_settlement_idx on daily_settlement_lines(settlement_id);
create index if not exists daily_settlement_lines_artist_idx on daily_settlement_lines(artist_id);

create table if not exists artist_weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  artist_id uuid references artists (id),
  day_of_week integer not null,
  start_time text not null,
  end_time text not null,
  location_id uuid references locations (id),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists artist_weekly_schedules_studio_idx on artist_weekly_schedules(studio_id);
create index if not exists artist_weekly_schedules_artist_idx on artist_weekly_schedules(artist_id);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_studios_updated_at
before update on studios
for each row execute procedure set_updated_at();

create trigger set_users_updated_at
before update on users
for each row execute procedure set_updated_at();

create trigger set_locations_updated_at
before update on locations
for each row execute procedure set_updated_at();

create trigger set_artists_updated_at
before update on artists
for each row execute procedure set_updated_at();

create trigger set_artist_locations_updated_at
before update on artist_locations
for each row execute procedure set_updated_at();

create trigger set_availabilities_updated_at
before update on availabilities
for each row execute procedure set_updated_at();

create trigger set_workstations_updated_at
before update on workstations
for each row execute procedure set_updated_at();

create trigger set_customers_updated_at
before update on customers
for each row execute procedure set_updated_at();

create trigger set_appointment_types_updated_at
before update on appointment_types
for each row execute procedure set_updated_at();

create trigger set_appointments_updated_at
before update on appointments
for each row execute procedure set_updated_at();

create trigger set_payments_updated_at
before update on payments
for each row execute procedure set_updated_at();

create trigger set_reporting_categories_updated_at
before update on reporting_categories
for each row execute procedure set_updated_at();

create trigger set_products_updated_at
before update on products
for each row execute procedure set_updated_at();

create trigger set_appointment_charges_updated_at
before update on appointment_charges
for each row execute procedure set_updated_at();

create trigger set_artist_split_rules_updated_at
before update on artist_split_rules
for each row execute procedure set_updated_at();

create trigger set_daily_settlements_updated_at
before update on daily_settlements
for each row execute procedure set_updated_at();

create trigger set_artist_weekly_schedules_updated_at
before update on artist_weekly_schedules
for each row execute procedure set_updated_at();

create or replace function public.apply_product_checkout_stock(p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_studio uuid;
  v_stock integer;
begin
  for r in
    select (x->>'product_id')::uuid as product_id,
           (x->>'quantity')::int as quantity
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  loop
    if r.product_id is null or r.quantity is null or r.quantity <= 0 then
      continue;
    end if;

    select studio_id, stock_quantity into v_studio, v_stock
    from public.products
    where id = r.product_id
    for update;

    if v_studio is null then
      raise exception 'Product not found';
    end if;
    if v_studio is distinct from public.current_user_studio() then
      raise exception 'Not allowed';
    end if;

    if v_stock is null then
      continue;
    end if;

    if v_stock < r.quantity then
      raise exception 'Insufficient stock';
    end if;

    update public.products
    set stock_quantity = v_stock - r.quantity
    where id = r.product_id;
  end loop;
end;
$$;

grant execute on function public.apply_product_checkout_stock(jsonb) to authenticated;

create or replace function public.apply_product_checkout_stock_system(p_studio_id uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_studio uuid;
  v_stock integer;
begin
  if p_studio_id is null then
    raise exception 'studio_id required';
  end if;

  for r in
    select (x->>'product_id')::uuid as product_id,
           (x->>'quantity')::int as quantity
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  loop
    if r.product_id is null or r.quantity is null or r.quantity <= 0 then
      continue;
    end if;

    select studio_id, stock_quantity into v_studio, v_stock
    from public.products
    where id = r.product_id
    for update;

    if v_studio is null then
      raise exception 'Product not found';
    end if;
    if v_studio is distinct from p_studio_id then
      raise exception 'Not allowed';
    end if;

    if v_stock is null then
      continue;
    end if;

    if v_stock < r.quantity then
      raise exception 'Insufficient stock';
    end if;

    update public.products
    set stock_quantity = v_stock - r.quantity
    where id = r.product_id;
  end loop;
end;
$$;

grant execute on function public.apply_product_checkout_stock_system(uuid, jsonb) to service_role;
