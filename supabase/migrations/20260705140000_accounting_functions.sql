-- RPCs for the unified accounting flow.
--
--   finalize_sale_internal()      -> shared engine: writes a sale, its line items,
--                                    the balance payment, stock decrement, appointment
--                                    completion, and artist accrual ledger entries.
--   finalize_sale()               -> authenticated wrapper (studio from session).
--   finalize_sale_system()        -> service-role wrapper (explicit studio; used by
--                                    the Stripe webhook for online checkouts).
--   void_appointment_sale()       -> unhook a completed appointment from revenue.
--   compute_daily_reconciliation()-> (re)builds a daily POS close from payments.

-- Persisted so the day-close can aggregate per-artist earnings without walking
-- individual ledger rows. Safe to re-run.
alter table public.sales add column if not exists artist_share numeric not null default 0;

-- ---------------------------------------------------------------------------
-- Shared engine
-- ---------------------------------------------------------------------------
create or replace function public.finalize_sale_internal(
  p_studio uuid,
  p_created_by uuid,
  p_sale jsonb,
  p_lines jsonb,
  p_payment jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz            text;
  v_sale_date     date;
  v_business_date date;
  v_appointment   uuid;
  v_artist        uuid;
  v_sale_id       uuid;
  v_line          jsonb;
  v_qty           numeric;
  v_unit          numeric;
  v_disc          numeric;
  v_rate          numeric;
  v_incl          boolean;
  v_sign          smallint;
  v_gross         numeric;
  v_net           numeric;
  v_tax           numeric;
  v_subtotal      numeric := 0;
  v_tax_total     numeric := 0;
  v_disc_total    numeric := 0;
  v_tip           numeric := coalesce((p_sale->>'tip_total')::numeric, 0);
  v_total         numeric;
  v_artist_share  numeric := coalesce((p_sale->>'artist_share')::numeric, 0);
  v_pay_amount    numeric;
  v_pay_tender    text;
  v_pay_channel   text;
  v_pay_bizdate   date;
  v_prev_bizdate  date;
  v_stock         jsonb := '[]'::jsonb;
begin
  if p_studio is null then
    raise exception 'No studio';
  end if;

  select timezone into v_tz from public.studios where id = p_studio;
  v_tz := coalesce(v_tz, 'UTC');

  v_sale_date := coalesce(nullif(p_sale->>'sale_date', '')::date, (now() at time zone v_tz)::date);
  v_business_date := (now() at time zone v_tz)::date;
  v_appointment := nullif(p_sale->>'appointment_id', '')::uuid;
  v_artist := nullif(p_sale->>'artist_id', '')::uuid;

  -- Re-checkout: clear any prior sale for this appointment (and its accrual /
  -- balance rows). Deposits (purpose='deposit') are preserved and unlinked.
  -- Capture the prior cash date first: a correction must not relocate the money
  -- to today's POS batch. The original balance was collected on its own day.
  if v_appointment is not null then
    select min(business_date) into v_prev_bizdate
    from public.payments
    where appointment_id = v_appointment and purpose in ('balance', 'retail');

    delete from public.artist_ledger_entries
      where studio_id = p_studio
        and sale_id in (select id from public.sales where appointment_id = v_appointment and studio_id = p_studio);
    delete from public.payments
      where sale_id in (select id from public.sales where appointment_id = v_appointment and studio_id = p_studio)
        and purpose in ('balance', 'retail');
    delete from public.sales where appointment_id = v_appointment and studio_id = p_studio;
  end if;

  insert into public.sales (
    studio_id, location_id, artist_id, customer_id, appointment_id,
    sale_date, status, tip_total, notes, created_by
  ) values (
    p_studio,
    nullif(p_sale->>'location_id', '')::uuid,
    v_artist,
    nullif(p_sale->>'customer_id', '')::uuid,
    v_appointment,
    v_sale_date, 'completed', v_tip, nullif(p_sale->>'notes', ''), p_created_by
  )
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_qty  := coalesce((v_line->>'quantity')::numeric, 1);
    v_unit := coalesce((v_line->>'unit_price')::numeric, 0);
    v_disc := coalesce((v_line->>'discount_amount')::numeric, 0);
    v_rate := coalesce((v_line->>'tax_rate')::numeric, 0);
    v_incl := coalesce((v_line->>'tax_inclusive')::boolean, false);
    v_sign := coalesce((v_line->>'revenue_sign')::smallint, 1);

    v_gross := greatest(0, v_qty * v_unit - v_disc);
    if v_rate > 0 and v_incl then
      v_net := v_gross / (1 + v_rate);
      v_tax := v_gross - v_net;
    elsif v_rate > 0 then
      v_net := v_gross;
      v_tax := v_gross * v_rate;
    else
      v_net := v_gross;
      v_tax := 0;
    end if;

    insert into public.sale_line_items (
      studio_id, sale_id, line_type, reporting_category_id, reporting_category_name,
      product_id, description, quantity, unit_price, discount_amount,
      tax_rate, tax_inclusive, net_amount, tax_amount, line_total, revenue_sign
    ) values (
      p_studio, v_sale_id,
      coalesce(v_line->>'line_type', 'product'),
      nullif(v_line->>'reporting_category_id', '')::uuid,
      nullif(v_line->>'reporting_category_name', ''),
      nullif(v_line->>'product_id', '')::uuid,
      coalesce(v_line->>'description', 'Line item'),
      v_qty, v_unit, v_disc, v_rate, v_incl,
      v_sign * v_net, v_sign * v_tax, v_sign * (v_net + v_tax), v_sign
    );

    v_subtotal   := v_subtotal + v_sign * v_net;
    v_tax_total  := v_tax_total + v_sign * v_tax;
    v_disc_total := v_disc_total + v_disc;

    if coalesce(v_line->>'line_type', '') = 'product'
       and nullif(v_line->>'product_id', '') is not null
       and v_sign > 0 then
      v_stock := v_stock || jsonb_build_array(jsonb_build_object(
        'product_id', v_line->>'product_id', 'quantity', v_qty));
    end if;
  end loop;

  v_total := v_subtotal + v_tax_total + v_tip;

  update public.sales
    set subtotal = v_subtotal, tax_total = v_tax_total,
        discount_total = v_disc_total, total = v_total,
        artist_share = v_artist_share
    where id = v_sale_id;

  if v_appointment is not null then
    update public.appointments
      set status = 'completed', charge_amount = v_subtotal, tax_amount = v_tax_total,
          tip_amount = v_tip, discount_amount = v_disc_total,
          payment_method = coalesce(p_payment->>'tender_type', payment_method)
      where id = v_appointment and studio_id = p_studio;

    update public.payments set sale_id = v_sale_id
      where appointment_id = v_appointment and purpose = 'deposit' and sale_id is null;
  end if;

  if jsonb_array_length(v_stock) > 0 then
    perform public.apply_product_checkout_stock_system(p_studio, v_stock);
  end if;

  v_pay_amount := coalesce((p_payment->>'amount')::numeric, 0);
  if p_payment is not null and v_pay_amount > 0 then
    v_pay_tender := coalesce(p_payment->>'tender_type', 'Other');
    v_pay_channel := coalesce(p_payment->>'channel',
      case when v_pay_tender = 'Stripe' then 'online' else 'in_person' end);
    -- Cash date precedence: explicit override -> original balance's date (on a
    -- re-checkout correction) -> today. This keeps corrections on the POS batch
    -- day the money actually moved instead of jumping to the current date.
    v_pay_bizdate := coalesce(
      nullif(p_payment->>'business_date', '')::date,
      v_prev_bizdate,
      v_business_date
    );
    insert into public.payments (
      studio_id, location_id, sale_id, appointment_id, customer_id,
      business_date, occurred_at, amount, tender_type, channel, purpose,
      status, paid_at, currency
    ) values (
      p_studio, nullif(p_sale->>'location_id', '')::uuid, v_sale_id, v_appointment,
      nullif(p_sale->>'customer_id', '')::uuid,
      v_pay_bizdate, now(), v_pay_amount, v_pay_tender, v_pay_channel,
      case when v_appointment is null then 'retail' else 'balance' end,
      'paid', now(),
      (select coalesce(currency, 'USD') from public.studios where id = p_studio)
    );
  end if;

  -- Artist earnings are NOT posted per sale. The sale stores artist_share and
  -- tip_total; closing the day's reconciliation posts two consolidated ledger
  -- lines per artist (Service fees + Tips). See close_daily_reconciliation().

  return v_sale_id;
end;
$$;

-- Authenticated wrapper: studio + user come from the session.
create or replace function public.finalize_sale(
  p_sale jsonb,
  p_lines jsonb,
  p_payment jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid := public.current_user_studio();
begin
  if v_studio is null then
    raise exception 'No studio in session';
  end if;
  return public.finalize_sale_internal(v_studio, auth.uid(), p_sale, p_lines, p_payment);
end;
$$;

-- Service-role wrapper for the Stripe webhook (no session).
create or replace function public.finalize_sale_system(
  p_studio uuid,
  p_sale jsonb,
  p_lines jsonb,
  p_payment jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.finalize_sale_internal(p_studio, null, p_sale, p_lines, p_payment);
end;
$$;

grant execute on function public.finalize_sale(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.finalize_sale_system(uuid, jsonb, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- void_appointment_sale
-- ---------------------------------------------------------------------------
create or replace function public.void_appointment_sale(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid := public.current_user_studio();
begin
  if v_studio is null then
    raise exception 'No studio in session';
  end if;

  delete from public.artist_ledger_entries
    where studio_id = v_studio
      and sale_id in (select id from public.sales where appointment_id = p_appointment_id and studio_id = v_studio);
  delete from public.payments
    where sale_id in (select id from public.sales where appointment_id = p_appointment_id and studio_id = v_studio)
      and purpose in ('balance', 'retail');
  delete from public.sales where appointment_id = p_appointment_id and studio_id = v_studio;
end;
$$;

grant execute on function public.void_appointment_sale(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- compute_daily_reconciliation
-- ---------------------------------------------------------------------------
create or replace function public.compute_daily_reconciliation(
  p_location_id uuid,
  p_business_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio      uuid := public.current_user_studio();
  v_recon_id    uuid;
  v_status      text;
  v_in_person   numeric := 0;
  v_online      numeric := 0;
  v_ref_ip      numeric := 0;
  v_ref_on      numeric := 0;
begin
  if v_studio is null then
    raise exception 'No studio in session';
  end if;
  if public.current_user_role() not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin may reconcile';
  end if;

  select id, status into v_recon_id, v_status
  from public.daily_reconciliations
  where studio_id = v_studio and location_id = p_location_id and business_date = p_business_date;

  if v_status = 'closed' then
    return v_recon_id;
  end if;

  select
    coalesce(sum(amount) filter (where channel = 'in_person'), 0),
    coalesce(sum(amount) filter (where channel = 'online'), 0),
    coalesce(-sum(amount) filter (where channel = 'in_person' and purpose = 'refund'), 0),
    coalesce(-sum(amount) filter (where channel = 'online' and purpose = 'refund'), 0)
  into v_in_person, v_online, v_ref_ip, v_ref_on
  from public.payments
  where studio_id = v_studio and location_id = p_location_id
    and business_date = p_business_date and status = 'paid';

  if v_recon_id is null then
    insert into public.daily_reconciliations (
      studio_id, location_id, business_date, status,
      in_person_total, online_total, refunds_in_person, refunds_online
    ) values (
      v_studio, p_location_id, p_business_date, 'open',
      v_in_person, v_online, v_ref_ip, v_ref_on
    )
    returning id into v_recon_id;
  else
    update public.daily_reconciliations
      set in_person_total = v_in_person, online_total = v_online,
          refunds_in_person = v_ref_ip, refunds_online = v_ref_on,
          variance = case when pos_reported_total is not null
                          then v_in_person - pos_reported_total else variance end
      where id = v_recon_id;
  end if;

  delete from public.reconciliation_tenders where reconciliation_id = v_recon_id;
  insert into public.reconciliation_tenders (studio_id, reconciliation_id, tender_type, system_amount)
  select v_studio, v_recon_id, tender_type, sum(amount)
  from public.payments
  where studio_id = v_studio and location_id = p_location_id
    and business_date = p_business_date and status = 'paid' and channel = 'in_person'
  group by tender_type;

  return v_recon_id;
end;
$$;

grant execute on function public.compute_daily_reconciliation(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- record_refund_payment — refund row + negative cash payment (when applicable)
-- ---------------------------------------------------------------------------
create or replace function public.record_refund_payment(
  p_appointment_id uuid,
  p_amount numeric,
  p_refund_method text,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio uuid := public.current_user_studio();
  v_apt record;
  v_sale_id uuid;
  v_refund_id uuid;
  v_tz text;
  v_business_date date;
  v_tender text;
  v_channel text;
begin
  if v_studio is null then
    raise exception 'No studio in session';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Refund amount must be positive';
  end if;
  if p_refund_method not in ('cash', 'card', 'store_credit') then
    raise exception 'Invalid refund method';
  end if;

  select a.*, st.timezone as studio_tz
    into v_apt
  from public.appointments a
  join public.studios st on st.id = a.studio_id
  where a.id = p_appointment_id and a.studio_id = v_studio;

  if v_apt.id is null then
    raise exception 'Appointment not found';
  end if;

  select id into v_sale_id
  from public.sales
  where appointment_id = p_appointment_id and studio_id = v_studio
  limit 1;

  insert into public.appointment_refunds (
    studio_id, appointment_id, amount, refund_method, notes
  ) values (
    v_studio, p_appointment_id, p_amount, p_refund_method, p_notes
  )
  returning id into v_refund_id;

  if p_refund_method in ('cash', 'card') then
    v_tz := coalesce(v_apt.studio_tz, 'UTC');
    v_business_date := (now() at time zone v_tz)::date;
    v_tender := case p_refund_method when 'cash' then 'Cash' else 'Other' end;
    v_channel := 'in_person';

    insert into public.payments (
      studio_id, location_id, sale_id, appointment_id, customer_id,
      business_date, occurred_at, amount, tender_type, channel, purpose,
      status, paid_at, currency, metadata
    ) values (
      v_studio, v_apt.location_id, v_sale_id, p_appointment_id, v_apt.customer_id,
      v_business_date, now(), -abs(p_amount), v_tender, v_channel, 'refund',
      'paid', now(),
      (select coalesce(currency, 'USD') from public.studios where id = v_studio),
      jsonb_build_object('refund_id', v_refund_id::text, 'refund_method', p_refund_method)
    );
  end if;

  return v_refund_id;
end;
$$;

grant execute on function public.record_refund_payment(uuid, numeric, text, text) to authenticated;
