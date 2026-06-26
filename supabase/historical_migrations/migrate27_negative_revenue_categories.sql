-- Migration 27: Add revenue_sign to reporting_categories for negative-revenue category types
-- (gift card returns, discount coupons entered as positive but stored as negative revenue)

alter table reporting_categories
  add column if not exists revenue_sign text not null default 'positive'
  check (revenue_sign in ('positive', 'negative'));

comment on column reporting_categories.revenue_sign is
  'positive: normal revenue. negative: staff enters positive amounts but line_total is stored negative (e.g. gift card returns, discount coupons).';
