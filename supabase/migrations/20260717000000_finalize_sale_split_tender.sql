-- Split tender at checkout: finalize_sale accepts a single payment object (legacy)
-- or a JSON array of payments. Each becomes its own payments row on one sale.
-- Tip portion may be stored in payment metadata; tip_total on the sale is unchanged.

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
  v_pay_list      jsonb;
  v_pay           jsonb;
  v_pay_amount    numeric;
  v_pay_tender    text;
  v_pay_channel   text;
  v_pay_bizdate   date;
  v_pay_meta      jsonb;
  v_pay_methods   text;
  v_prev_bizdate  date;
  v_stock         jsonb := '[]'::jsonb;
  v_ord           int;
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

  -- Normalize to array (legacy callers still pass a single object).
  v_pay_list := case
    when p_payment is null then '[]'::jsonb
    when jsonb_typeof(p_payment) = 'array' then p_payment
    else jsonb_build_array(p_payment)
  end;

  -- Re-checkout: clear any prior sale for this appointment (and its accrual /
  -- balance rows). Deposits (purpose='deposit') are preserved and unlinked.
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

  -- Comma-join tender types in array order for appointments.payment_method.
  select string_agg(coalesce(nullif(elem->>'tender_type', ''), 'Other'), ', ' order by ord)
    into v_pay_methods
  from jsonb_array_elements(v_pay_list) with ordinality as t(elem, ord)
  where coalesce((elem->>'amount')::numeric, 0) > 0;

  if v_appointment is not null then
    update public.appointments
      set status = 'completed', charge_amount = v_subtotal, tax_amount = v_tax_total,
          tip_amount = v_tip, discount_amount = v_disc_total,
          payment_method = coalesce(v_pay_methods, payment_method)
      where id = v_appointment and studio_id = p_studio;

    update public.payments set sale_id = v_sale_id
      where appointment_id = v_appointment and purpose = 'deposit' and sale_id is null;
  end if;

  if jsonb_array_length(v_stock) > 0 then
    perform public.apply_product_checkout_stock_system(p_studio, v_stock);
  end if;

  v_ord := 0;
  for v_pay in select * from jsonb_array_elements(v_pay_list)
  loop
    v_ord := v_ord + 1;
    v_pay_amount := coalesce((v_pay->>'amount')::numeric, 0);
    if v_pay_amount <= 0 then
      continue;
    end if;

    v_pay_tender := coalesce(nullif(v_pay->>'tender_type', ''), 'Other');
    v_pay_channel := coalesce(v_pay->>'channel',
      case when v_pay_tender = 'Stripe' then 'online' else 'in_person' end);
    v_pay_bizdate := coalesce(
      nullif(v_pay->>'business_date', '')::date,
      v_prev_bizdate,
      v_business_date
    );
    v_pay_meta := case
      when v_pay->'metadata' is not null and jsonb_typeof(v_pay->'metadata') = 'object'
        then v_pay->'metadata'
      else null
    end;

    insert into public.payments (
      studio_id, location_id, sale_id, appointment_id, customer_id,
      business_date, occurred_at, amount, tender_type, channel, purpose,
      status, paid_at, currency, metadata
    ) values (
      p_studio, nullif(p_sale->>'location_id', '')::uuid, v_sale_id, v_appointment,
      nullif(p_sale->>'customer_id', '')::uuid,
      v_pay_bizdate, now(), v_pay_amount, v_pay_tender, v_pay_channel,
      case when v_appointment is null then 'retail' else 'balance' end,
      'paid', now(),
      (select coalesce(currency, 'USD') from public.studios where id = p_studio),
      v_pay_meta
    );
  end loop;

  return v_sale_id;
end;
$$;

-- Soft-void on unlock: keep sale lines + voided balance payments so CheckoutDialog
-- can preload the prior cart/tenders. Cash/recon ignore non-paid statuses; reports
-- ignore non-completed sales. Re-checkout via finalize_sale still hard-deletes these.
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

  update public.payments
    set status = 'voided', updated_at = now()
    where sale_id in (select id from public.sales where appointment_id = p_appointment_id and studio_id = v_studio)
      and purpose in ('balance', 'retail')
      and status = 'paid';

  update public.sales
    set status = 'voided', updated_at = now()
    where appointment_id = p_appointment_id and studio_id = v_studio
      and status = 'completed';
end;
$$;
