-- Migration 10: Product supplier info, optional stock tracking, tax rate, checkout stock RPC.

alter table public.products
  add column if not exists supplier_name text,
  add column if not exists supplier_sku text,
  add column if not exists stock_quantity integer,
  add column if not exists tax_rate numeric not null default 0.13;

comment on column public.products.stock_quantity is 'When null, stock is not tracked at checkout. When set, must be sufficient to complete sale.';
comment on column public.products.tax_rate is 'Decimal rate, e.g. 0.13 for 13%. Use 0 for non-taxable items such as gift cards.';

-- Atomically decrement tracked stock for studio members at checkout (RLS blocks direct product updates for non-admins).
create or replace function public.apply_product_checkout_stock(p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_studio uuid;
  v_stock integer;
begin
  for r in
    select (x->>'product_id')::uuid as product_id,
           (x->>'quantity')::int as quantity
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  loop
    if r.product_id is null or r.quantity is null or r.quantity <= 0 then
      continue;
    end if;

    select studio_id, stock_quantity into v_studio, v_stock
    from public.products
    where id = r.product_id
    for update;

    if v_studio is null then
      raise exception 'Product not found';
    end if;
    if v_studio is distinct from public.current_user_studio() then
      raise exception 'Not allowed';
    end if;

    if v_stock is null then
      continue;
    end if;

    if v_stock < r.quantity then
      raise exception 'Insufficient stock';
    end if;

    update public.products
    set stock_quantity = v_stock - r.quantity
    where id = r.product_id;
  end loop;
end;
$$;

grant execute on function public.apply_product_checkout_stock(jsonb) to authenticated;
