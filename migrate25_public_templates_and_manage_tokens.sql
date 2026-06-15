-- Feature 2: Editable public booking page disclaimer
alter table public.studios
  add column if not exists booking_page_disclaimer_template text;

-- Feature 3: Per appointment-kind notification overrides
create table if not exists appointment_kind_notification_settings (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios(id) on delete cascade,
  kind_root_category_id uuid not null references reporting_categories(id) on delete cascade,
  notification_kind text not null check (notification_kind in (
    'reminder_primary', 'reminder_secondary', 'followup_quick', 'followup_longterm'
  )),
  enabled boolean,
  minutes integer,
  subject_template text,
  body_template text,
  aftercare_template text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (kind_root_category_id, notification_kind)
);

create index if not exists akns_studio_idx
  on appointment_kind_notification_settings(studio_id);

create trigger set_akns_updated_at
  before update on appointment_kind_notification_settings
  for each row execute procedure set_updated_at();

-- RLS for appointment_kind_notification_settings
alter table appointment_kind_notification_settings enable row level security;

drop policy if exists akns_select on appointment_kind_notification_settings;
create policy akns_select on appointment_kind_notification_settings
  for select using (
    studio_id in (select studio_id from users where id = auth.uid())
  );

drop policy if exists akns_insert on appointment_kind_notification_settings;
create policy akns_insert on appointment_kind_notification_settings
  for insert with check (
    studio_id in (
      select studio_id from users
      where id = auth.uid() and user_role in ('Owner', 'Admin')
    )
  );

drop policy if exists akns_update on appointment_kind_notification_settings;
create policy akns_update on appointment_kind_notification_settings
  for update using (
    studio_id in (
      select studio_id from users
      where id = auth.uid() and user_role in ('Owner', 'Admin')
    )
  );

drop policy if exists akns_delete on appointment_kind_notification_settings;
create policy akns_delete on appointment_kind_notification_settings
  for delete using (
    studio_id in (
      select studio_id from users
      where id = auth.uid() and user_role in ('Owner', 'Admin')
    )
  );

-- Feature 4: Appointment manage tokens for customer self-service reschedule/cancel
create table if not exists appointment_manage_tokens (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists amt_appointment_idx on appointment_manage_tokens(appointment_id);
create index if not exists amt_token_idx on appointment_manage_tokens(token);

alter table appointment_manage_tokens enable row level security;

-- Tokens are only accessed via edge functions with service role key; no direct RLS access.
-- Service-role edge functions bypass RLS. Authenticated studio users can read tokens
-- for their studio's appointments for admin visibility.
drop policy if exists amt_select on appointment_manage_tokens;
create policy amt_select on appointment_manage_tokens
  for select using (
    appointment_id in (
      select a.id from appointments a
      join users u on u.studio_id = a.studio_id
      where u.id = auth.uid()
    )
  );
