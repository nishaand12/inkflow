-- Category detail reporting: per-item (product / appointment type) snapshots
-- under each reporting category, plus a paginated period rollup RPC.

-- ---------------------------------------------------------------------------
-- Snapshot table
-- ---------------------------------------------------------------------------
create table if not exists public.reconciliation_report_category_items (
  id                    uuid primary key default gen_random_uuid(),
  reconciliation_id     uuid not null references public.daily_reconciliations (id) on delete cascade,
  studio_id             uuid not null references public.studios (id),
  category_key          text not null,
  reporting_category_id uuid references public.reporting_categories (id) on delete set null,
  item_key              text not null,
  item_name             text not null,
  item_kind             text not null default 'manual',
  product_id            uuid references public.products (id) on delete set null,
  appointment_type_id   uuid references public.appointment_types (id) on delete set null,
  item_barcode          text,
  item_count            numeric not null default 0,
  gross_total           numeric not null default 0,
  shop_split            numeric not null default 0,
  created_at            timestamptz not null default now()
);

create unique index if not exists reconciliation_report_category_items_unique_idx
  on public.reconciliation_report_category_items (reconciliation_id, category_key, item_key);
create index if not exists reconciliation_report_category_items_studio_idx
  on public.reconciliation_report_category_items (studio_id);
create index if not exists reconciliation_report_category_items_category_idx
  on public.reconciliation_report_category_items (studio_id, category_key);

alter table public.reconciliation_report_category_items enable row level security;

drop policy if exists reconciliation_report_category_items_select
  on public.reconciliation_report_category_items;
create policy reconciliation_report_category_items_select
  on public.reconciliation_report_category_items
  for select using (studio_id = public.current_user_studio());

-- ---------------------------------------------------------------------------
-- snapshot_reconciliation_report — add category item rows
-- (base body from 20260715120000_reporting_tender_groups.sql)
-- ---------------------------------------------------------------------------
create or replace function public.snapshot_reconciliation_report(p_reconciliation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recon public.daily_reconciliations%rowtype;
  v_future_deposits numeric := 0;
begin
  select * into v_recon
  from public.daily_reconciliations
  where id = p_reconciliation_id;

  if v_recon.id is null then
    raise exception 'Reconciliation not found: %', p_reconciliation_id;
  end if;

  delete from public.reconciliation_report_sales where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_artists where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_category_items where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_categories where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_summaries where reconciliation_id = p_reconciliation_id;

  -- Future deposits: unattached paid deposits collected IN PERSON on this
  -- business_date. Online (Stripe) deposits are reconciled against Stripe.
  select coalesce(sum(p.amount), 0) into v_future_deposits
  from public.payments p
  where p.studio_id = v_recon.studio_id
    and p.location_id = v_recon.location_id
    and p.business_date = v_recon.business_date
    and p.status = 'paid'
    and p.purpose = 'deposit'
    and p.channel = 'in_person'
    and p.sale_id is null;

  insert into public.reconciliation_report_summaries (
    reconciliation_id, studio_id, location_id, business_date,
    sale_count, subtotal, tax_total, discount_total, tip_total,
    merchandise_total, total,
    in_person_total, online_total, refunds_in_person, refunds_online,
    future_deposits_total, pos_reported_total, variance
  )
  select
    v_recon.id,
    v_recon.studio_id,
    v_recon.location_id,
    v_recon.business_date,
    coalesce(agg.sale_count, 0),
    coalesce(agg.subtotal, 0),
    coalesce(agg.tax_total, 0),
    coalesce(agg.discount_total, 0),
    coalesce(agg.tip_total, 0),
    coalesce(agg.merchandise_total, 0),
    coalesce(agg.total, 0),
    v_recon.in_person_total,
    v_recon.online_total,
    v_recon.refunds_in_person,
    v_recon.refunds_online,
    v_future_deposits,
    v_recon.pos_reported_total,
    v_recon.variance
  from (
    select
      count(s.id)::integer as sale_count,
      coalesce(sum(s.subtotal), 0) as subtotal,
      coalesce(sum(s.tax_total), 0) as tax_total,
      coalesce(sum(s.discount_total), 0) as discount_total,
      coalesce(sum(s.tip_total), 0) as tip_total,
      coalesce(sum(s.subtotal + s.tax_total), 0) as merchandise_total,
      coalesce(sum(s.total), 0) as total
    from public.sales s
    where s.studio_id = v_recon.studio_id
      and s.location_id = v_recon.location_id
      and s.sale_date = v_recon.business_date
      and s.status = 'completed'
  ) agg;

  -- Categories: tax-inclusive gross plus the shop's split of each category.
  -- Per sale, artist_share is allocated across service lines proportional to
  -- each line's tax-inclusive total; non-service lines are 100% shop.
  insert into public.reconciliation_report_categories (
    reconciliation_id, studio_id, category_key, reporting_category_id,
    category_name, gross_total, item_count, shop_split
  )
  select
    v_recon.id,
    v_recon.studio_id,
    cat.category_key,
    cat.reporting_category_id,
    cat.category_name,
    cat.gross_total,
    cat.item_count,
    cat.shop_split
  from (
    select
      case
        when li.reporting_category_id is not null then 'id:' || li.reporting_category_id::text
        else 'name:' || coalesce(nullif(trim(li.reporting_category_name), ''), 'Uncategorized')
      end as category_key,
      li.reporting_category_id,
      coalesce(
        nullif(public.reporting_category_path_label(v_recon.studio_id, li.reporting_category_id), ''),
        nullif(trim(li.reporting_category_name), ''),
        'Uncategorized'
      ) as category_name,
      sum(coalesce(li.line_total, 0)) as gross_total,
      sum(coalesce(li.quantity, 1)) as item_count,
      sum(
        coalesce(li.line_total, 0)
        - case
            when li.line_type = 'service' and coalesce(svc.svc_incl, 0) > 0
              then coalesce(s.artist_share, 0) * coalesce(li.line_total, 0) / svc.svc_incl
            else 0
          end
      ) as shop_split
    from public.sale_line_items li
    inner join public.sales s
      on s.id = li.sale_id
     and s.studio_id = v_recon.studio_id
     and s.location_id = v_recon.location_id
     and s.sale_date = v_recon.business_date
     and s.status = 'completed'
    left join lateral (
      select sum(coalesce(l2.line_total, 0)) as svc_incl
      from public.sale_line_items l2
      where l2.sale_id = s.id
        and l2.studio_id = v_recon.studio_id
        and l2.line_type = 'service'
    ) svc on true
    where li.studio_id = v_recon.studio_id
    group by 1, 2, 3
  ) cat;

  -- Category items: product / appointment type / description rollups within
  -- each category. Shop split uses the same allocation as category totals.
  insert into public.reconciliation_report_category_items (
    reconciliation_id, studio_id, category_key, reporting_category_id,
    item_key, item_name, item_kind, product_id, appointment_type_id,
    item_barcode, item_count, gross_total, shop_split
  )
  select
    v_recon.id,
    v_recon.studio_id,
    items.category_key,
    items.reporting_category_id,
    items.item_key,
    items.item_name,
    items.item_kind,
    items.product_id,
    items.appointment_type_id,
    items.item_barcode,
    items.item_count,
    items.gross_total,
    items.shop_split
  from (
    select
      case
        when li.reporting_category_id is not null then 'id:' || li.reporting_category_id::text
        else 'name:' || coalesce(nullif(trim(li.reporting_category_name), ''), 'Uncategorized')
      end as category_key,
      li.reporting_category_id,
      case
        when li.product_id is not null then 'product:' || li.product_id::text
        when a.appointment_type_id is not null and li.line_type = 'service'
          then 'apt_type:' || a.appointment_type_id::text
        else 'desc:' || li.line_type || ':' || lower(trim(coalesce(li.description, '')))
      end as item_key,
      case
        when li.product_id is not null then
          coalesce(nullif(trim(p.name), ''), nullif(trim(li.description), ''), 'Product')
        when a.appointment_type_id is not null and li.line_type = 'service' then
          coalesce(nullif(trim(at.name), ''), nullif(trim(li.description), ''), 'Service')
        else coalesce(nullif(trim(li.description), ''), initcap(replace(li.line_type, '_', ' ')))
      end as item_name,
      case
        when li.product_id is not null then 'product'
        when a.appointment_type_id is not null and li.line_type = 'service' then 'appointment_type'
        when li.line_type = 'adjustment' then 'adjustment'
        when li.line_type = 'gift_card' then 'gift_card'
        when li.line_type = 'service' then 'service'
        else 'manual'
      end as item_kind,
      li.product_id,
      case
        when li.product_id is null and li.line_type = 'service' then a.appointment_type_id
        else null
      end as appointment_type_id,
      case when li.product_id is not null then nullif(trim(p.barcode), '') else null end as item_barcode,
      sum(coalesce(li.quantity, 1)) as item_count,
      sum(coalesce(li.line_total, 0)) as gross_total,
      sum(
        coalesce(li.line_total, 0)
        - case
            when li.line_type = 'service' and coalesce(svc.svc_incl, 0) > 0
              then coalesce(s.artist_share, 0) * coalesce(li.line_total, 0) / svc.svc_incl
            else 0
          end
      ) as shop_split
    from public.sale_line_items li
    inner join public.sales s
      on s.id = li.sale_id
     and s.studio_id = v_recon.studio_id
     and s.location_id = v_recon.location_id
     and s.sale_date = v_recon.business_date
     and s.status = 'completed'
    left join public.products p
      on p.id = li.product_id
     and p.studio_id = v_recon.studio_id
    left join public.appointments a
      on a.id = s.appointment_id
     and a.studio_id = v_recon.studio_id
    left join public.appointment_types at
      on at.id = a.appointment_type_id
     and at.studio_id = v_recon.studio_id
    left join lateral (
      select sum(coalesce(l2.line_total, 0)) as svc_incl
      from public.sale_line_items l2
      where l2.sale_id = s.id
        and l2.studio_id = v_recon.studio_id
        and l2.line_type = 'service'
    ) svc on true
    where li.studio_id = v_recon.studio_id
    group by 1, 2, 3, 4, 5, 6, 7, 8
  ) items;

  insert into public.reconciliation_report_sales (
    reconciliation_id, studio_id, sale_id, sale_date, artist_id,
    service_total, tax_total, service_tax_total, product_tax_total,
    product_total, tip_total, artist_share, shop_revenue, artist_owed
  )
  select
    v_recon.id,
    v_recon.studio_id,
    s.id,
    s.sale_date,
    s.artist_id,
    coalesce(svc.service_total, 0),
    tx.tax_total,
    tx.service_tax,
    tx.tax_total - tx.service_tax,
    coalesce(svc.product_total, 0),
    coalesce(s.tip_total, 0),
    coalesce(s.artist_share, 0),
    coalesce(svc.service_total, 0)
      + coalesce(svc.product_total, 0)
      + tx.tax_total
      - coalesce(s.artist_share, 0),
    coalesce(s.artist_share, 0) + coalesce(s.tip_total, 0)
  from public.sales s
  left join lateral (
    select
      sum(case when li.line_type = 'service' then coalesce(li.net_amount, 0) else 0 end) as service_total,
      sum(coalesce(li.tax_amount, 0)) as line_tax_total,
      sum(case when li.line_type = 'service' then coalesce(li.tax_amount, 0) else 0 end) as service_tax_total,
      sum(case when li.line_type <> 'service' then coalesce(li.net_amount, 0) else 0 end) as product_total
    from public.sale_line_items li
    where li.sale_id = s.id and li.studio_id = v_recon.studio_id
  ) svc on true
  cross join lateral (
    select
      greatest(coalesce(s.tax_total, 0), coalesce(svc.line_tax_total, 0)) as tax_total,
      least(
        greatest(coalesce(svc.service_tax_total, 0), 0),
        greatest(coalesce(s.tax_total, 0), coalesce(svc.line_tax_total, 0))
      ) as service_tax
  ) tx
  where s.studio_id = v_recon.studio_id
    and s.location_id = v_recon.location_id
    and s.sale_date = v_recon.business_date
    and s.status = 'completed';

  insert into public.reconciliation_report_artists (
    reconciliation_id, studio_id, artist_id,
    service_total, tax_total, service_tax_total, product_tax_total,
    product_total, tip_total, artist_share,
    shop_revenue, artist_owed, sale_count
  )
  select
    v_recon.id,
    v_recon.studio_id,
    rs.artist_id,
    sum(rs.service_total),
    sum(rs.tax_total),
    sum(rs.service_tax_total),
    sum(rs.product_tax_total),
    sum(rs.product_total),
    sum(rs.tip_total),
    sum(rs.artist_share),
    sum(rs.shop_revenue),
    sum(rs.artist_owed),
    count(*)::integer
  from public.reconciliation_report_sales rs
  where rs.reconciliation_id = v_recon.id
  group by rs.artist_id;
end;
$$;

grant execute on function public.snapshot_reconciliation_report(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reopen_daily_reconciliation — also clear category item snapshots
-- ---------------------------------------------------------------------------
create or replace function public.reopen_daily_reconciliation(p_reconciliation_id uuid)
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
  if public.current_user_role() not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin may reopen a reconciliation';
  end if;

  delete from public.artist_ledger_entries
  where reconciliation_id = p_reconciliation_id and studio_id = v_studio;

  delete from public.reconciliation_report_sales where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_artists where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_category_items where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_categories where reconciliation_id = p_reconciliation_id;
  delete from public.reconciliation_report_summaries where reconciliation_id = p_reconciliation_id;

  update public.daily_reconciliations
    set status = 'open', closed_at = null, closed_by = null
    where id = p_reconciliation_id and studio_id = v_studio;
end;
$$;

grant execute on function public.reopen_daily_reconciliation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_reconciliation_category_item_totals
-- Period rollup of category items for one category (optionally including
-- descendants). Sorted alphabetically by item_name; paginated.
-- ---------------------------------------------------------------------------
create or replace function public.get_reconciliation_category_item_totals(
  p_start_date date,
  p_end_date date,
  p_location_id uuid default null,
  p_category_key text default null,
  p_include_descendants boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_studio uuid := public.current_user_studio();
  v_rows json;
  v_summary json;
  v_category_name text;
  v_total integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_category_key text := nullif(trim(p_category_key), '');
  v_root_id uuid;
begin
  if v_studio is null then
    raise exception 'No studio in session';
  end if;
  if public.current_user_role() not in ('Owner', 'Admin') then
    raise exception 'Only Owner/Admin may view reports';
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Invalid date range';
  end if;
  if v_category_key is null then
    raise exception 'Category key is required';
  end if;

  if v_category_key like 'id:%' then
    begin
      v_root_id := substr(v_category_key, 4)::uuid;
    exception when others then
      raise exception 'Invalid category key: %', v_category_key;
    end;
  end if;

  with recursive
  descendants as (
    select rc.id
    from public.reporting_categories rc
    where rc.studio_id = v_studio
      and coalesce(rc.category_role, 'reporting') = 'reporting'
      and v_root_id is not null
      and rc.id = v_root_id
    union all
    select child.id
    from public.reporting_categories child
    inner join descendants d on child.parent_id = d.id
    where child.studio_id = v_studio
      and coalesce(child.category_role, 'reporting') = 'reporting'
  ),
  filtered as (
    select
      i.item_key,
      i.item_name,
      i.item_kind,
      i.product_id,
      i.appointment_type_id,
      i.item_barcode,
      i.item_count,
      i.gross_total,
      i.shop_split,
      i.category_key,
      coalesce(
        nullif(public.reporting_category_path_label(v_studio, i.reporting_category_id), ''),
        case
          when i.category_key like 'name:%' then substr(i.category_key, 6)
          else null
        end,
        'Uncategorized'
      ) as category_name
    from public.reconciliation_report_category_items i
    inner join public.daily_reconciliations r on r.id = i.reconciliation_id
    where r.studio_id = v_studio
      and r.status = 'closed'
      and i.studio_id = v_studio
      and r.business_date between p_start_date and p_end_date
      and (p_location_id is null or r.location_id = p_location_id)
      and (
        (
          coalesce(p_include_descendants, false)
          and v_root_id is not null
          and i.reporting_category_id in (select id from descendants)
        )
        or i.category_key = v_category_key
      )
  ),
  aggregated as (
    select
      item_key,
      max(item_name) as item_name,
      max(item_kind) as item_kind,
      max(product_id::text)::uuid as product_id,
      max(appointment_type_id::text)::uuid as appointment_type_id,
      max(item_barcode) as item_barcode,
      round(sum(item_count), 2) as item_count,
      round(sum(gross_total), 2) as gross_total,
      round(sum(shop_split), 2) as shop_split
    from filtered
    group by item_key
  )
  select
    (select count(*)::integer from aggregated),
    case
      when v_root_id is not null then
        coalesce(
          nullif(public.reporting_category_path_label(v_studio, v_root_id), ''),
          (select name from public.reporting_categories where id = v_root_id and studio_id = v_studio),
          'Category'
        )
      when v_category_key like 'name:%' then substr(v_category_key, 6)
      else coalesce((select max(category_name) from filtered), 'Category')
    end,
    (
      select json_build_object(
        'item_count', round(coalesce(sum(item_count), 0), 2),
        'gross_total', round(coalesce(sum(gross_total), 0), 2),
        'shop_split', round(coalesce(sum(shop_split), 0), 2)
      )
      from aggregated
    ),
    (
      select coalesce(json_agg(row_to_json(page_rows) order by page_rows.item_name asc, page_rows.item_key asc), '[]'::json)
      from (
        select
          a.item_key,
          a.item_name,
          a.item_kind,
          a.product_id,
          a.appointment_type_id,
          a.item_barcode,
          a.item_count,
          a.gross_total,
          a.shop_split
        from aggregated a
        order by a.item_name asc, a.item_key asc
        limit v_limit
        offset v_offset
      ) page_rows
    )
  into v_total, v_category_name, v_summary, v_rows;

  return json_build_object(
    'rows', coalesce(v_rows, '[]'::json),
    'total_count', coalesce(v_total, 0),
    'limit', v_limit,
    'offset', v_offset,
    'category_key', v_category_key,
    'category_name', coalesce(v_category_name, 'Category'),
    'summary', coalesce(
      v_summary,
      json_build_object('item_count', 0, 'gross_total', 0, 'shop_split', 0)
    )
  );
end;
$$;

grant execute on function public.get_reconciliation_category_item_totals(
  date, date, uuid, text, boolean, integer, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill closed reconciliations so historical ranges have item detail
-- ---------------------------------------------------------------------------
do $$
declare
  v_recon record;
begin
  for v_recon in
    select id from public.daily_reconciliations where status = 'closed'
  loop
    perform public.snapshot_reconciliation_report(v_recon.id);
  end loop;
end;
$$;
