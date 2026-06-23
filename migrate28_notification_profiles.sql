-- Migration 28: Notification profiles system
-- Replaces per-kind-root overrides with profile + assignment model.
-- Adds 2 new notification slots (reminder_tertiary, followup_midterm),
-- notification_anchor_at for late-booking skip, and booking_source.

-- New columns on appointments
alter table appointments add column if not exists reminder_tertiary_sent_at timestamptz;
alter table appointments add column if not exists followup_midterm_sent_at timestamptz;
alter table appointments add column if not exists notification_anchor_at timestamptz default now();
alter table appointments add column if not exists booking_source text;

-- Profiles: each studio can have up to 5 (enforced in UI)
create table if not exists studio_notification_profiles (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  display_order integer not null default 0,

  -- Confirmation slot
  confirmation_enabled boolean not null default true,
  confirmation_subject text,
  confirmation_body text,

  -- Reminder: 3 days before (secondary)
  reminder_secondary_enabled boolean not null default true,
  reminder_secondary_minutes integer not null default 4320,
  reminder_secondary_subject text,
  reminder_secondary_body text,

  -- Reminder: 1 day before (primary)
  reminder_primary_enabled boolean not null default false,
  reminder_primary_minutes integer not null default 1440,
  reminder_primary_subject text,
  reminder_primary_body text,

  -- Reminder: day-of (tertiary) — default 2h before
  reminder_tertiary_enabled boolean not null default false,
  reminder_tertiary_minutes integer not null default 120,
  reminder_tertiary_subject text,
  reminder_tertiary_body text,

  -- Follow-up: quick (2h after end)
  followup_quick_enabled boolean not null default true,
  followup_quick_minutes integer not null default 120,
  followup_quick_subject text,
  followup_quick_body text,

  -- Follow-up: long-term (21 days after end)
  followup_longterm_enabled boolean not null default true,
  followup_longterm_minutes integer not null default 30240,
  followup_longterm_subject text,
  followup_longterm_body text,

  -- Follow-up: mid-term (75 days after end)
  followup_midterm_enabled boolean not null default false,
  followup_midterm_minutes integer not null default 108000,
  followup_midterm_subject text,
  followup_midterm_body text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists snp_studio_idx on studio_notification_profiles(studio_id);

create trigger set_snp_updated_at
before update on studio_notification_profiles
for each row execute procedure set_updated_at();

-- Assignments: map appointment kind categories to profiles
create table if not exists appointment_kind_notification_assignments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios(id) on delete cascade,
  kind_category_id uuid not null references reporting_categories(id) on delete cascade,
  profile_id uuid not null references studio_notification_profiles(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (studio_id, kind_category_id)
);

create index if not exists akna_studio_idx on appointment_kind_notification_assignments(studio_id);

create trigger set_akna_updated_at
before update on appointment_kind_notification_assignments
for each row execute procedure set_updated_at();

-- RLS for profiles
alter table studio_notification_profiles enable row level security;

drop policy if exists snp_select on studio_notification_profiles;
create policy snp_select on studio_notification_profiles
  for select using (studio_id = public.current_user_studio());

drop policy if exists snp_insert on studio_notification_profiles;
create policy snp_insert on studio_notification_profiles
  for insert with check (
    studio_id = public.current_user_studio()
    and public.current_user_role() in ('Owner', 'Admin')
  );

drop policy if exists snp_update on studio_notification_profiles;
create policy snp_update on studio_notification_profiles
  for update using (
    studio_id = public.current_user_studio()
    and public.current_user_role() in ('Owner', 'Admin')
  );

drop policy if exists snp_delete on studio_notification_profiles;
create policy snp_delete on studio_notification_profiles
  for delete using (
    studio_id = public.current_user_studio()
    and public.current_user_role() in ('Owner', 'Admin')
  );

-- RLS for assignments
alter table appointment_kind_notification_assignments enable row level security;

drop policy if exists akna_select on appointment_kind_notification_assignments;
create policy akna_select on appointment_kind_notification_assignments
  for select using (studio_id = public.current_user_studio());

drop policy if exists akna_insert on appointment_kind_notification_assignments;
create policy akna_insert on appointment_kind_notification_assignments
  for insert with check (
    studio_id = public.current_user_studio()
    and public.current_user_role() in ('Owner', 'Admin')
  );

drop policy if exists akna_update on appointment_kind_notification_assignments;
create policy akna_update on appointment_kind_notification_assignments
  for update using (
    studio_id = public.current_user_studio()
    and public.current_user_role() in ('Owner', 'Admin')
  );

drop policy if exists akna_delete on appointment_kind_notification_assignments;
create policy akna_delete on appointment_kind_notification_assignments
  for delete using (
    studio_id = public.current_user_studio()
    and public.current_user_role() in ('Owner', 'Admin')
  );
