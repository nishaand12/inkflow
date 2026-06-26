-- Migration 26: Supplies tracking module (manual list, all staff)

create table if not exists supplies (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references studios(id) on delete cascade,
  item_name text not null,
  item_description text,
  supplier text,
  status text not null default 'In Stock' check (status in ('In Stock', 'Running Low', 'Order Now', 'Out of Stock', 'Ordered')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists supplies_studio_idx on supplies(studio_id);

create trigger set_supplies_updated_at
before update on supplies
for each row execute procedure set_updated_at();

-- RLS: all studio members can read and write
alter table supplies enable row level security;

drop policy if exists supplies_select on supplies;
create policy supplies_select on supplies
  for select using (studio_id = public.current_user_studio());

drop policy if exists supplies_insert on supplies;
create policy supplies_insert on supplies
  for insert with check (studio_id = public.current_user_studio());

drop policy if exists supplies_update on supplies;
create policy supplies_update on supplies
  for update using (studio_id = public.current_user_studio());

drop policy if exists supplies_delete on supplies;
create policy supplies_delete on supplies
  for delete using (studio_id = public.current_user_studio());
