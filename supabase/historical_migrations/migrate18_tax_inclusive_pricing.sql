-- Per product / appointment type: whether unit price is tax-inclusive or tax-exclusive at checkout.

alter table public.products
add column if not exists price_includes_tax boolean not null default false;

comment on column public.products.price_includes_tax is
  'When true, price (and line total after discount) includes sales tax; tax is backed out for reporting. When false, tax is added on top.';

alter table public.appointment_types
add column if not exists price_includes_tax boolean not null default false;

comment on column public.appointment_types.price_includes_tax is
  'When true, service line at checkout is tax-inclusive (default studio tax rate applies to extract tax). When false, tax is added on top of the service amount.';
