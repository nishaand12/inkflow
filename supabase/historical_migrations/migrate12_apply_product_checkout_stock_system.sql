-- RPC for system/webhook contexts: decrement stock when studio_id is explicitly trusted (e.g. Stripe webhook).
create or replace function public.apply_product_checkout_stock_system(p_studio_id uuid, p_lines jsonb)
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
  if p_studio_id is null then
    raise exception 'studio_id required';
  end if;

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
    if v_studio is distinct from p_studio_id then
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

grant execute on function public.apply_product_checkout_stock_system(uuid, jsonb) to service_role;
