-- Per-artist opt-in for appointment-type-level revenue split overrides.

alter table public.artists
  add column if not exists appointment_type_split_enabled boolean not null default false;

-- Artists who already have per-type overrides stay eligible.
update public.artists a
set appointment_type_split_enabled = true
where exists (
  select 1 from public.artist_split_rules r
  where r.artist_id = a.id
    and r.appointment_type_id is not null
    and r.is_active = true
);
