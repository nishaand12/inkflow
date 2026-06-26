-- Hierarchical reporting / appointment categories
-- category_role: 'reporting' = revenue/products; 'appointment_kind' = appointment type grouping (separate forest)
-- clinical_profile: optional hint for health/clinical UI (tattoo vs piercing) on appointment_kind nodes

alter table public.reporting_categories
  add column if not exists parent_id uuid references public.reporting_categories (id) on delete set null;

alter table public.reporting_categories
  add column if not exists category_role text not null default 'reporting';

alter table public.reporting_categories
  add column if not exists clinical_profile text;

alter table public.reporting_categories
  drop constraint if exists reporting_categories_category_role_check;

alter table public.reporting_categories
  add constraint reporting_categories_category_role_check
  check (category_role in ('reporting', 'appointment_kind'));

alter table public.reporting_categories
  drop constraint if exists reporting_categories_clinical_profile_check;

alter table public.reporting_categories
  add constraint reporting_categories_clinical_profile_check
  check (clinical_profile is null or clinical_profile in ('tattoo', 'piercing'));

create index if not exists reporting_categories_parent_idx on public.reporting_categories (parent_id);

comment on column public.reporting_categories.parent_id is 'Parent category in the same role tree (reporting vs appointment_kind)';
comment on column public.reporting_categories.category_role is 'reporting: revenue hierarchy; appointment_kind: configurable appointment type categories';
comment on column public.reporting_categories.clinical_profile is 'Optional: tattoo or piercing clinical fields when this appointment_kind node applies';

alter table public.appointment_types
  add column if not exists appointment_kind_category_id uuid references public.reporting_categories (id) on delete set null;

comment on column public.appointment_types.appointment_kind_category_id is 'Leaf reporting_categories row (category_role=appointment_kind) for this type';

-- Legacy category column remains for backfill / reads; new UI uses appointment_kind_category_id
alter table public.appointment_types alter column category drop not null;

-- Public booking page loads appointment kind tree without authenticated user
drop policy if exists reporting_categories_select_anon_appointment_kind on public.reporting_categories;
create policy reporting_categories_select_anon_appointment_kind
on public.reporting_categories
for select
to anon
using (
  category_role = 'appointment_kind'
  and is_active = true
  and exists (
    select 1 from studios s
    where s.id = reporting_categories.studio_id and s.is_active = true
  )
);

-- Public booking page loads appointment kind tree without authenticated user
drop policy if exists reporting_categories_select_anon_appointment_kind on public.reporting_categories;
create policy reporting_categories_select_anon_appointment_kind
on public.reporting_categories
for select
to anon
using (
  category_role = 'appointment_kind'
  and is_active = true
  and exists (
    select 1 from studios s
    where s.id = reporting_categories.studio_id and s.is_active = true
  )
);
