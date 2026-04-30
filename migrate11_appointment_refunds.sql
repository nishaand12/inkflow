-- Appointment-linked refunds (cash / card reversal / store credit). Simple audit trail per checkout session.

create table if not exists public.appointment_refunds (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  amount numeric not null check (amount > 0),
  refund_method text not null check (refund_method in ('card', 'cash', 'store_credit')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists appointment_refunds_studio_idx on public.appointment_refunds (studio_id);
create index if not exists appointment_refunds_appointment_idx on public.appointment_refunds (appointment_id);

alter table public.appointment_refunds enable row level security;

drop policy if exists appointment_refunds_select on public.appointment_refunds;
create policy appointment_refunds_select
on public.appointment_refunds
for select
using (studio_id = public.current_user_studio());

drop policy if exists appointment_refunds_insert on public.appointment_refunds;
create policy appointment_refunds_insert
on public.appointment_refunds
for insert
with check (studio_id = public.current_user_studio());

drop policy if exists appointment_refunds_update on public.appointment_refunds;
create policy appointment_refunds_update
on public.appointment_refunds
for update
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);

drop policy if exists appointment_refunds_delete on public.appointment_refunds;
create policy appointment_refunds_delete
on public.appointment_refunds
for delete
using (
  studio_id = public.current_user_studio()
  and public.current_user_role() in ('Owner', 'Admin')
);
