-- Artist paybacks: money from artist → shop (inverse of payouts).
-- Reuses artist_payouts as the payment header with a direction column.
-- Ledger sign convention (unchanged): positive = studio owes artist.
--   payout  → entry_type 'payout',  amount = -N
--   payback → entry_type 'payback', amount = +N

alter table public.artist_payouts
  add column if not exists direction text;

update public.artist_payouts
set direction = 'to_artist'
where direction is null;

alter table public.artist_payouts
  alter column direction set default 'to_artist';

alter table public.artist_payouts
  alter column direction set not null;

alter table public.artist_payouts
  drop constraint if exists artist_payouts_direction_check;

alter table public.artist_payouts
  add constraint artist_payouts_direction_check
  check (direction = any (array['to_artist'::text, 'to_shop'::text]));

comment on column public.artist_payouts.direction is
  'to_artist = shop pays artist (payout); to_shop = artist pays shop (payback)';

alter table public.artist_ledger_entries
  drop constraint if exists artist_ledger_entries_entry_type_check;

alter table public.artist_ledger_entries
  add constraint artist_ledger_entries_entry_type_check
  check (entry_type = any (array[
    'settlement_share'::text,
    'tip'::text,
    'payout'::text,
    'payback'::text,
    'adjustment'::text
  ]));
