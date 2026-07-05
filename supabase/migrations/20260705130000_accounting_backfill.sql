-- Backfill the unified accounting tables from legacy data.
--
-- Safe to run once (each step is guarded with NOT EXISTS so a partial/re-run
-- will not duplicate rows). Nothing is deleted. Legacy tables (appointments,
-- appointment_charges, appointment_refunds, daily_settlements*) are left intact
-- as an archive until the app is fully switched over and totals are verified.

-- Tender normalizer: legacy method strings -> canonical checkout tender labels.
create or replace function public.normalize_tender(p_raw text)
returns text
language sql
immutable
as $$
  select case regexp_replace(lower(coalesce(p_raw, '')), '[^a-z]', '', 'g')
    when 'cash' then 'Cash'
    when 'etransfer' then 'E-Transfer'
    when 'interac' then 'Debit'
    when 'amex' then 'Amex'
    when 'mastercard' then 'Mastercard'
    when 'mc' then 'Mastercard'
    when 'visa' then 'Visa'
    when 'debit' then 'Debit'
    when 'cardterminal' then 'Debit'
    when 'pos' then 'Debit'
    when 'posterminal' then 'Debit'
    when 'terminal' then 'Debit'
    when 'stripe' then 'Stripe'
    else 'Other'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Sales from completed appointments. Header totals come from the legacy
--    authoritative fields, so revenue reports tie to history exactly.
-- ---------------------------------------------------------------------------
insert into public.sales (
  studio_id, location_id, artist_id, customer_id, appointment_id,
  sale_date, status, subtotal, tax_total, discount_total, tip_total, total,
  created_at, updated_at
)
select
  a.studio_id, a.location_id, a.artist_id, a.customer_id, a.id,
  a.appointment_date, 'completed',
  coalesce(a.charge_amount, 0),
  coalesce(a.tax_amount, 0),
  coalesce(a.discount_amount, 0),
  coalesce(a.tip_amount, 0),
  coalesce(a.charge_amount, 0) + coalesce(a.tax_amount, 0) + coalesce(a.tip_amount, 0),
  a.updated_at, a.updated_at
from public.appointments a
where a.status = 'completed'
  and not exists (select 1 from public.sales s where s.appointment_id = a.id);

-- ---------------------------------------------------------------------------
-- 2. Sale line items from appointment_charges. Historical per-line tax is
--    unknown, so tax stays 0 at the line and the authoritative tax lives on
--    the sale header; line_total is preserved verbatim for category reports.
-- ---------------------------------------------------------------------------
insert into public.sale_line_items (
  studio_id, sale_id, line_type, reporting_category_id, reporting_category_name,
  product_id, description, quantity, unit_price, discount_amount,
  tax_rate, tax_inclusive, net_amount, tax_amount, line_total, revenue_sign,
  created_at, updated_at
)
select
  c.studio_id, s.id,
  case when c.line_type in ('service', 'product', 'adjustment', 'gift_card')
       then c.line_type else 'product' end,
  c.reporting_category_id, c.reporting_category_name, c.product_id, c.description,
  c.quantity, c.unit_price, c.discount_amount,
  0, false,
  coalesce(c.line_total, 0),
  0,
  coalesce(c.line_total, 0),
  case when coalesce(c.line_total, 0) < 0 then -1 else 1 end,
  c.created_at, c.updated_at
from public.appointment_charges c
join public.sales s on s.appointment_id = c.appointment_id
where not exists (select 1 from public.sale_line_items sli where sli.sale_id = s.id);

-- ---------------------------------------------------------------------------
-- 3. Enrich existing payment rows (deposits + Stripe checkouts) with the new
--    tender/date/channel columns.
-- ---------------------------------------------------------------------------
update public.payments p
set
  business_date = (coalesce(p.paid_at, p.created_at) at time zone coalesce(st.timezone, 'UTC'))::date,
  location_id = a.location_id,
  channel = case
    when p.stripe_checkout_session_id is not null or p.stripe_payment_intent_id is not null then 'online'
    when lower(coalesce(p.metadata->>'method', '')) = 'stripe' then 'online'
    when lower(coalesce(p.metadata->>'collection_channel', '')) = 'online' then 'online'
    else 'in_person'
  end,
  tender_type = case
    when p.stripe_checkout_session_id is not null or p.stripe_payment_intent_id is not null
      or lower(coalesce(p.metadata->>'method', '')) = 'stripe' then 'Stripe'
    else public.normalize_tender(coalesce(p.metadata->>'method', a.payment_method))
  end,
  purpose = case p.payment_type
    when 'deposit' then 'deposit'
    when 'checkout' then 'balance'
    else coalesce(p.payment_type, 'balance')
  end,
  sale_id = s.id
from public.appointments a
join public.studios st on st.id = a.studio_id
left join public.sales s on s.appointment_id = a.id
where a.id = p.appointment_id
  and p.business_date is null;

-- ---------------------------------------------------------------------------
-- 4. Synthesize the in-person / online balance payments that never existed as
--    rows (legacy final balances were only implied by appointment.payment_method).
--    Each completed appointment's balance = total_due - credited paid deposit.
-- ---------------------------------------------------------------------------
insert into public.payments (
  studio_id, location_id, sale_id, appointment_id, customer_id,
  business_date, occurred_at, amount, tender_type, channel, purpose,
  status, paid_at, currency, metadata, created_at
)
select
  a.studio_id, a.location_id, s.id, a.id, a.customer_id,
  a.appointment_date, a.updated_at, bal.balance,
  case when a.payment_method = 'Stripe' then 'Stripe' else public.normalize_tender(a.payment_method) end,
  case when a.payment_method = 'Stripe' then 'online' else 'in_person' end,
  'balance', 'paid', a.updated_at, coalesce(st.currency, 'USD'),
  jsonb_build_object('backfilled', true),
  a.updated_at
from public.appointments a
join public.sales s on s.appointment_id = a.id
join public.studios st on st.id = a.studio_id
cross join lateral (
  select greatest(
    0,
    (coalesce(a.charge_amount, 0) + coalesce(a.tax_amount, 0) + coalesce(a.tip_amount, 0))
    - case when a.deposit_status = 'paid'
           then least(
             coalesce(a.deposit_amount, 0),
             coalesce(a.charge_amount, 0) + coalesce(a.tax_amount, 0) + coalesce(a.tip_amount, 0)
           )
           else 0 end
  ) as balance
) bal
where a.status = 'completed'
  and bal.balance > 0
  and not exists (
    select 1 from public.payments p
    where p.appointment_id = a.id and p.purpose = 'balance'
  );

-- ---------------------------------------------------------------------------
-- 5. Refunds -> negative payments (cash + card only; store credit is not a
--    cash movement and is handled on the accrual side).
-- ---------------------------------------------------------------------------
insert into public.payments (
  studio_id, location_id, sale_id, appointment_id, customer_id,
  business_date, occurred_at, amount, tender_type, channel, purpose,
  status, paid_at, currency, metadata, created_at
)
select
  r.studio_id, a.location_id, s.id, r.appointment_id, a.customer_id,
  (r.created_at at time zone coalesce(st.timezone, 'UTC'))::date,
  r.created_at, -abs(r.amount),
  case r.refund_method when 'cash' then 'Cash' else 'Other' end,
  'in_person', 'refund', 'paid', r.created_at, coalesce(st.currency, 'USD'),
  jsonb_build_object('backfilled', true, 'refund_method', r.refund_method, 'refund_backfill_id', r.id::text),
  r.created_at
from public.appointment_refunds r
join public.studios st on st.id = r.studio_id
left join public.appointments a on a.id = r.appointment_id
left join public.sales s on s.appointment_id = r.appointment_id
where r.refund_method in ('cash', 'card')
  and not exists (
    select 1 from public.payments p
    where p.purpose = 'refund'
      and p.metadata->>'refund_backfill_id' = r.id::text
  );
