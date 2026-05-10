-- Migration 17: Preferred work station per artist (internal scheduling UI / auto-select).

alter table public.artists
add column if not exists preferred_work_station_id uuid references public.workstations (id) on delete set null;

create index if not exists artists_preferred_work_station_id_idx
on public.artists (preferred_work_station_id)
where preferred_work_station_id is not null;
