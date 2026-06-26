-- Preserve payment audit rows when an appointment is deleted.

update public.payments
set metadata = coalesce(metadata, '{}'::jsonb)
  || jsonb_build_object('appointment_id', appointment_id)
where appointment_id is not null;

alter table public.payments
  drop constraint if exists payments_appointment_id_fkey;

alter table public.payments
  add constraint payments_appointment_id_fkey
  foreign key (appointment_id)
  references public.appointments (id)
  on delete set null;
