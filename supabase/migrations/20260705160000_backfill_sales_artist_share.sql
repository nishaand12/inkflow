-- Backfill sales.artist_share for sales created before artist_share was persisted
-- (e.g. rows produced by the accounting backfill). Mirrors the client-side split
-- math in src/utils/revenueSplits.js so payouts posted at day-close match what a
-- fresh checkout would have accrued.
--
-- Rule precedence (first match wins), active rules only:
--   1. appointment_type + artist   (only when the artist has appointment-type splits enabled)
--   2. appointment_type (no artist)
--   3. artist (no appointment_type)
--   4. none -> 0
--
-- Percent splits apply to service + the service portion of tax; fixed-amount
-- splits pay an exact dollar amount capped at pre-tax service. Products are 100%
-- shop revenue and never counted toward the artist share.
--
-- Idempotent: only fills sales whose artist_share is still 0.

with sale_amounts as (
  select
    li.sale_id,
    greatest(0, coalesce(sum(li.net_amount) filter (where li.line_type = 'service'), 0)) as service,
    greatest(0, coalesce(sum(li.net_amount) filter (where li.line_type <> 'service'), 0)) as product
  from public.sale_line_items li
  group by li.sale_id
),
sale_ctx as (
  select
    s.id                                            as sale_id,
    s.studio_id,
    s.artist_id,
    a.appointment_type_id,
    coalesce(art.appointment_type_split_enabled, false) as apt_split_enabled,
    coalesce(sa.service, 0)                         as service,
    coalesce(sa.product, 0)                         as product,
    coalesce(s.tax_total, 0)                        as tax
  from public.sales s
  left join public.appointments a on a.id = s.appointment_id
  left join public.artists art on art.id = s.artist_id
  left join sale_amounts sa on sa.sale_id = s.id
  where s.artist_id is not null
    and s.status = 'completed'
    and coalesce(s.artist_share, 0) = 0
),
resolved as (
  select
    c.*,
    r.split_mode,
    r.split_value,
    r.split_percent
  from sale_ctx c
  left join lateral (
    select sr.split_mode, sr.split_value, sr.split_percent
    from public.artist_split_rules sr
    where sr.studio_id = c.studio_id
      and coalesce(sr.is_active, true)
      and (
        (sr.appointment_type_id = c.appointment_type_id and sr.artist_id = c.artist_id and c.apt_split_enabled)
        or (sr.appointment_type_id = c.appointment_type_id and sr.artist_id is null)
        or (sr.artist_id = c.artist_id and sr.appointment_type_id is null)
      )
    order by
      case
        when sr.appointment_type_id = c.appointment_type_id and sr.artist_id = c.artist_id then 1
        when sr.appointment_type_id = c.appointment_type_id and sr.artist_id is null then 2
        when sr.artist_id = c.artist_id and sr.appointment_type_id is null then 3
        else 4
      end
    limit 1
  ) r on true
),
computed as (
  select
    sale_id,
    case
      when split_mode = 'fixed_amount'
        then least(greatest(coalesce(split_value, 0), 0), service)
      else
        (
          service
          + case when (service + product) > 0 and tax > 0
                 then tax * service / (service + product)
                 else 0 end
        )
        * (least(100, greatest(0, coalesce(split_value, split_percent, 0))) / 100.0)
    end as artist_share
  from resolved
)
update public.sales s
set artist_share = round(computed.artist_share::numeric, 2)
from computed
where s.id = computed.sale_id
  and computed.artist_share is not null
  and computed.artist_share <> 0;
