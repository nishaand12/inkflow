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

create table if not exists appointment_types (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references studios (id),
  category text not null,
  name text not null,
  description text,
  default_duration numeric not null,
  default_deposit numeric not null,
  is_active boolean default true,
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
  duration_hours numeric not null,
  deposit_amount numeric,
  total_estimate numeric,
  charge_amount numeric,
  tax_amount numeric,
  payment_method text,
  design_description text,
  placement text,
  notes text,
  invitees jsonb,
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
