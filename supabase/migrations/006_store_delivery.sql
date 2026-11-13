-- WESLA migration 006: store-delivered orders get a per-order fee and a buyer delivery code.
-- Requires 002 + 003. Safe to re-run. (Replaces the unreleased 006/007 drafts: if you ever ran those, this still works.)
--
--  * the store sets the delivery fee on EACH store-delivered order; the buyer approves or rejects it
--    (the store's saved fee stays as the "usual fee" estimate; proposing exactly that fee is auto-approved)
--  * delivery of a store-delivered order is confirmed with the buyer's 4-digit code (5 wrong tries lock it), exactly like platform couriers
--  * the store can name/phone the person delivering for it (shown to the buyer)
--  * a store can cancel an order that is already out for delivery, with a written reason
--  * codes come from gen_random_uuid() (cryptographic) instead of random()

alter table public.orders
  add column if not exists store_courier_name text,
  add column if not exists store_courier_phone text,
  add column if not exists cancel_reason text;
do $$ begin alter table public.orders add constraint orders_scname_chk check (store_courier_name is null or char_length(store_courier_name) between 1 and 60); exception when duplicate_object then null; end $$;
do $$ begin alter table public.orders add constraint orders_scphone_chk check (store_courier_phone is null or store_courier_phone ~ '^[0-9]{10,15}$'); exception when duplicate_object then null; end $$;
do $$ begin alter table public.orders add constraint orders_cancelreason_chk check (cancel_reason is null or char_length(cancel_reason) between 3 and 200); exception when duplicate_object then null; end $$;

create or replace function public._gen_code() returns text language sql volatile as $$
  select lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 10000)::text, 4, '0') $$;
revoke all on function public._gen_code() from public, anon, authenticated;

-- orders already in flight in "store delivery" mode get a delivery code too
insert into public.order_delivery_codes(order_id, code)
select o.id, public._gen_code() from public.orders o
 where o.delivery_mode = 'store' and o.status not in ('delivered','cancelled')
on conflict (order_id) do nothing;

drop function if exists public.create_order(uuid, jsonb, text, text, text, uuid, numeric, text, text, numeric, uuid, double precision, double precision);
create or replace function public.create_order(
  p_store_id uuid, p_items jsonb, p_mode text, p_address text, p_area text, p_zone_id uuid,
  p_proposed_fee numeric, p_payment text, p_note text, p_expected_subtotal numeric, p_key uuid,
  p_lat double precision default null, p_lng double precision default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_me public.profiles; v_store public.stores; v_zone public.delivery_zones; v_order uuid; v_exist uuid;
  v_sub numeric(10,2) := 0; v_fee numeric(10,2) := 0; v_max_fee numeric := 500; v_enforce text;
  v_fixed boolean := false; v_area text := ''; r record;
begin
  if p_key is not null then
    select id into v_exist from public.orders where customer_id = auth.uid() and idempotency_key = p_key;
    if found then return v_exist; end if;
  end if;
  select coalesce(nullif(value,'')::numeric,500) into v_max_fee from public.platform_settings where key='max_delivery_fee';
  v_max_fee := coalesce(v_max_fee,500);
  select * into v_me from public.profiles where id = auth.uid();
  if not found or v_me.is_blocked or v_me.role <> 'customer' then raise exception 'not allowed'; end if;
  if v_me.phone is null then raise exception 'phone required'; end if;
  select * into v_store from public.stores where id = p_store_id and status = 'active';
  if not found then raise exception 'store unavailable'; end if;
  if not v_store.is_open then raise exception 'store closed'; end if;
  select value into v_enforce from public.platform_settings where key = 'enforce_subscription';
  if coalesce(v_enforce,'false') = 'true' and v_store.subscription_status = 'expired' then raise exception 'store unavailable'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'invalid items'; end if;
  if (select count(*) from public.orders where customer_id = auth.uid() and status not in ('delivered','cancelled')) >= 3 then raise exception 'too many open orders'; end if;
  if (select count(*) from public.orders where customer_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then raise exception 'too many orders'; end if;
  if p_payment = 'cash' then
    if not v_store.accepts_cash then raise exception 'payment unavailable'; end if;
  elsif p_payment = 'vodafone_cash' then
    if v_store.vodafone_cash_number is null then raise exception 'payment unavailable'; end if;
  else raise exception 'payment unavailable'; end if;
  if p_mode not in ('pickup','store','courier') then raise exception 'invalid mode'; end if;
  if p_note is not null and char_length(p_note) > 300 then raise exception 'invalid note'; end if;
  if (p_lat is null) <> (p_lng is null) or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'invalid location'; end if;

  if p_mode = 'pickup' then
    v_area := 'استلام من المحل';
  else
    if p_address is null or char_length(btrim(p_address)) not between 3 and 300 then raise exception 'address required'; end if;
    if p_mode = 'store' then
      if not v_store.own_delivery then raise exception 'delivery unavailable'; end if;
      v_fee := coalesce(v_store.own_delivery_fee, 0); v_fixed := false; v_area := 'توصيل من المحل';  -- the store sets the real fee per order; this is only the usual fee shown as an estimate
    elsif p_zone_id is not null then
      select * into v_zone from public.delivery_zones where id = p_zone_id and is_active;
      if not found then raise exception 'invalid zone'; end if;
      v_fee := v_zone.fee; v_fixed := true; v_area := v_zone.name;
    else
      if p_area is null or char_length(btrim(p_area)) not between 2 and 60 then raise exception 'area required'; end if;
      if p_proposed_fee is null or p_proposed_fee < 0 or p_proposed_fee > v_max_fee then raise exception 'invalid fee'; end if;
      v_fee := round(p_proposed_fee, 2); v_area := btrim(p_area);
    end if;
  end if;

  insert into public.orders(customer_id, store_id, address_snapshot, area_hint, subtotal, proposed_delivery_fee, delivery_required, delivery_fee, total,
                            fee_status, delivery_mode, zone_id, fee_fixed, payment_method, payment_status, note, idempotency_key)
  values (auth.uid(), p_store_id, v_area, v_area, 0, v_fee, p_mode <> 'pickup', v_fee, 0,
          case when p_mode in ('courier','store') and not v_fixed then 'pending' else 'accepted' end,
          p_mode, case when p_mode = 'courier' then p_zone_id else null end, v_fixed, p_payment,
          case when p_payment = 'cash' then 'cod' else 'awaiting' end, nullif(btrim(coalesce(p_note,'')),''), p_key)
  returning id into v_order;

  for r in select (e->>'product_id')::uuid as pid, (e->>'qty')::int as qty from jsonb_array_elements(p_items) e loop
    if r.qty is null or r.qty < 1 or r.qty > 50 then raise exception 'invalid quantity'; end if;
    insert into public.order_items(order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, line_total, image_path_snapshot)
    select v_order, p.id, p.name, p.price, r.qty, p.price * r.qty, p.image_path
      from public.products p where p.id = r.pid and p.store_id = p_store_id and p.is_available;
    if not found then raise exception 'product unavailable'; end if;
  end loop;
  select coalesce(sum(line_total), 0) into v_sub from public.order_items where order_id = v_order;
  if p_expected_subtotal is not null and abs(p_expected_subtotal - v_sub) > 0.009 then raise exception 'price changed'; end if;
  update public.orders set subtotal = v_sub, total = v_sub + v_fee where id = v_order;
  insert into public.order_contacts(order_id, customer_name, customer_phone) values (v_order, v_me.full_name, v_me.phone);
  if p_mode <> 'pickup' then insert into public.order_addresses(order_id, address, lat, lng) values (v_order, btrim(p_address), p_lat, p_lng); end if;
  if p_mode in ('courier','store') then
    insert into public.order_delivery_codes(order_id, code) values (v_order, public._gen_code());
  end if;
  if p_mode = 'courier' then
    insert into public.order_pickup_codes(order_id, code) values (v_order, public._gen_code());
  end if;
  return v_order;
end $$;

create or replace function public.merchant_set_order_status(p_order_id uuid, p_status public.order_status, p_prep integer default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; ok boolean;
begin
  if public.is_blocked() then raise exception 'not allowed'; end if;
  select o2.* into o from public.orders o2 join public.stores s on s.id = o2.store_id
   where o2.id = p_order_id and s.owner_id = auth.uid() for update of o2;
  if not found then raise exception 'order not found'; end if;
  if p_prep is not null and p_prep not between 1 and 240 then raise exception 'invalid prep time'; end if;
  ok := (p_status = 'cancelled' and o.status in ('new','accepted','preparing','ready'))
     or (o.status = 'new' and p_status in ('accepted','ready'))
     or (o.status = 'accepted' and p_status in ('preparing','ready'))
     or (o.status = 'preparing' and p_status = 'ready')
     or (o.status = 'ready' and p_status = 'delivered' and o.delivery_mode = 'pickup')
     ;  -- store-delivered orders now leave through merchant_dispatch_order and finish through merchant_deliver_order (buyer's code)
  if not ok then raise exception 'invalid transition'; end if;
  if p_status = 'delivered' and o.payment_status not in ('cod','confirmed') then raise exception 'payment pending'; end if;
  update public.orders set status = p_status,
         accepted_at = case when p_status in ('accepted','ready') and o.status = 'new' then now() else accepted_at end,
         prep_minutes = case when p_status = 'accepted' then p_prep else prep_minutes end
   where id = o.id;
end $$;

create or replace function public.notify_order_events() returns trigger language plpgsql security definer set search_path = public as $$
declare v_no text := '#' || new.order_no::text; v_owner uuid;
begin
  select owner_id into v_owner from public.stores where id = new.store_id;
  if tg_op = 'INSERT' then
    perform public._notify(v_owner, 'طلب جديد', 'وصلك طلب جديد ' || v_no || ' · ' || case new.payment_method when 'vodafone_cash' then 'فودافون كاش' else 'دفع عند الاستلام' end, new.id);
    return new;
  end if;
  if new.status is distinct from old.status then
    perform public._notify(new.customer_id, 'تحديث الطلب', 'الطلب ' || v_no || ': ' || public.status_ar(new.status), new.id);
    perform public._notify(v_owner, 'تحديث الطلب', 'الطلب ' || v_no || ': ' || public.status_ar(new.status), new.id);
    perform public._notify(new.courier_id, 'تحديث الطلب', 'الطلب ' || v_no || ': ' || public.status_ar(new.status), new.id);
  end if;
  if new.delivery_mode = 'courier' and new.courier_id is null and new.status in ('accepted','preparing','ready')
     and ((old.status = 'new' and new.status in ('accepted','ready')) or old.courier_id is not null) then
    insert into public.notifications(user_id, title, body, order_id)
    select p.id, 'مهمة توصيل جديدة', 'طلب ' || v_no || ' متاح في ' || new.area_hint || ' · الأجرة ' || new.delivery_fee || ' ج.م', new.id
      from public.profiles p
     where p.role = 'courier' and not p.is_blocked and p.id is distinct from auth.uid() and p.id is distinct from old.courier_id
       and not exists (select 1 from public.orders o where o.courier_id = p.id and o.status not in ('delivered','cancelled'))
       and not exists (select 1 from public.order_declines d where d.order_id = new.id and d.courier_id = p.id);
  end if;
  if new.delivery_mode = 'store' then
    if new.fee_status = 'countered' and (old.fee_status is distinct from 'countered' or old.delivery_fee is distinct from new.delivery_fee) then
      perform public._notify(new.customer_id, 'المحل حدد أجرة التوصيل', 'الطلب ' || v_no || ': أجرة التوصيل ' || new.delivery_fee || ' ج.م. افتح الطلب ووافق أو ارفض.', new.id);
    elsif old.fee_status = 'countered' and new.fee_status = 'accepted' then
      perform public._notify(v_owner, 'وافق المشتري على الأجرة', 'الطلب ' || v_no || ': وافق المشتري على أجرة التوصيل.', new.id);
    elsif old.fee_status = 'countered' and new.fee_status = 'pending' then
      perform public._notify(v_owner, 'المشتري رفض الأجرة', 'الطلب ' || v_no || ': رفض المشتري الأجرة. حدد أجرة أخرى.', new.id);
    end if;
  elsif new.fee_status is distinct from old.fee_status then
    if new.fee_status = 'countered' then
      perform public._notify(new.customer_id, 'المندوب اقترح أجرة', 'الطلب ' || v_no || ': المندوب طلب ' || new.courier_proposed_fee || ' ج.م للتوصيل. راجع العرض.', new.id);
    elsif old.fee_status = 'countered' and new.fee_status = 'accepted' then
      perform public._notify(new.courier_id, 'تمت الموافقة على الأجرة', 'الطلب ' || v_no || ': وافق المشتري على أجرتك.', new.id);
    elsif old.fee_status = 'countered' and new.fee_status = 'pending' then
      perform public._notify(old.courier_id, 'تم رفض الأجرة', 'الطلب ' || v_no || ': رفض المشتري الأجرة المقترحة.', new.id);
    end if;
  end if;
  if new.courier_id is distinct from old.courier_id and new.courier_id is not null then
    perform public._notify(v_owner, 'تم تعيين مندوب', 'الطلب ' || v_no || ': سيستلمه مندوب. افتح الطلب لتشوف اسمه وكود التسليم.', new.id);
  end if;
  if new.payment_status is distinct from old.payment_status then
    if new.payment_status = 'proof_submitted' then
      perform public._notify(v_owner, 'إثبات دفع جديد', 'الطلب ' || v_no || ': المشتري أرسل بيانات تحويل فودافون كاش. راجعها وأكّد.', new.id);
    elsif new.payment_status = 'confirmed' then
      perform public._notify(new.customer_id, 'تم تأكيد الدفع', 'الطلب ' || v_no || ': المحل أكّد استلام الدفع.', new.id);
    elsif old.payment_status = 'proof_submitted' and new.payment_status = 'awaiting' then
      perform public._notify(new.customer_id, 'لم يتم تأكيد الدفع', 'الطلب ' || v_no || ': المحل لم يجد التحويل. راجع البيانات وأعد الإرسال.', new.id);
    end if;
  end if;
  return new;
end $$;

create or replace function public.customer_cancel_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'order not found'; end if;
  if o.payment_status in ('proof_submitted','confirmed') then raise exception 'invalid transition'; end if;
  if not (o.status = 'new'
          or (o.status = 'accepted' and o.courier_id is null and o.accepted_at > now() - interval '3 minutes')
          or (o.delivery_mode = 'store' and o.status in ('accepted','preparing','ready') and o.fee_status <> 'accepted')) then raise exception 'invalid transition'; end if;
  update public.orders set status = 'cancelled' where id = o.id;
end $$;

create or replace function public.expire_stale_orders() returns integer language plpgsql security definer set search_path = public as $$
declare v_min integer := 30; n integer := 0; r record;
begin
  select coalesce(nullif(value,'')::integer, 30) into v_min from public.platform_settings where key = 'new_order_timeout_min';
  v_min := greatest(5, least(coalesce(v_min,30), 1440));
  update public.orders set status = 'cancelled' where status = 'new' and created_at < now() - make_interval(mins => v_min);
  get diagnostics n = row_count;
  for r in select * from public.orders where fee_status = 'countered' and courier_id is not null and status in ('accepted','preparing','ready') and updated_at < now() - interval '15 minutes' for update loop
    insert into public.order_declines(order_id, courier_id) values (r.id, r.courier_id) on conflict do nothing;
    delete from public.order_courier_contacts where order_id = r.id;
    update public.orders set courier_id = null, courier_proposed_fee = null, courier_reply = null, fee_status = 'pending',
           delivery_fee = r.proposed_delivery_fee, total = r.subtotal + r.proposed_delivery_fee where id = r.id;
  end loop;
  -- store-delivered order whose buyer ignored the store's fee proposal for 30 min (nothing paid yet): cancel it
  update public.orders set status = 'cancelled'
   where delivery_mode = 'store' and fee_status = 'countered' and status in ('accepted','preparing','ready')
     and payment_status in ('cod','awaiting') and updated_at < now() - interval '30 minutes';
  return n;
end $$;

-- the store proposes (or re-proposes) the delivery fee of one store-delivered order
create or replace function public.merchant_set_delivery_fee(p_order_id uuid, p_fee numeric)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; v_fee numeric(10,2); v_max numeric := 500;
begin
  if public.is_blocked() then raise exception 'not allowed'; end if;
  select coalesce(nullif(value,'')::numeric,500) into v_max from public.platform_settings where key = 'max_delivery_fee';
  v_max := coalesce(v_max, 500);
  select o2.* into o from public.orders o2 join public.stores s on s.id = o2.store_id
   where o2.id = p_order_id and s.owner_id = auth.uid() for update of o2;
  if not found then raise exception 'order not found'; end if;
  if o.delivery_mode <> 'store' or o.status not in ('new','accepted','preparing','ready') or o.fee_status not in ('pending','countered') then
    raise exception 'invalid transition';
  end if;
  if p_fee is null or p_fee < 0 or p_fee > v_max then raise exception 'invalid fee'; end if;
  v_fee := round(p_fee, 2);
  update public.orders set delivery_fee = v_fee, total = subtotal + v_fee,
         fee_status = case when v_fee = proposed_delivery_fee then 'accepted' else 'countered' end
   where id = o.id;
end $$;

-- the store hands the order to whoever delivers for it (name/phone optional)
create or replace function public.merchant_dispatch_order(p_order_id uuid, p_name text default null, p_phone text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; v_name text := nullif(btrim(coalesce(p_name,'')), ''); v_phone text := nullif(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g'), '');
begin
  if public.is_blocked() then raise exception 'not allowed'; end if;
  select o2.* into o from public.orders o2 join public.stores s on s.id = o2.store_id
   where o2.id = p_order_id and s.owner_id = auth.uid() for update of o2;
  if not found then raise exception 'order not found'; end if;
  if o.delivery_mode <> 'store' or o.status <> 'ready' then raise exception 'invalid transition'; end if;
  if o.fee_status <> 'accepted' then raise exception 'fee not agreed'; end if;
  if o.payment_status not in ('cod','confirmed') then raise exception 'payment pending'; end if;
  if v_name is not null and char_length(v_name) > 60 then raise exception 'invalid name'; end if;
  if v_phone is not null and char_length(v_phone) not between 10 and 15 then raise exception 'invalid phone'; end if;
  update public.orders set status = 'with_courier', store_courier_name = v_name, store_courier_phone = v_phone where id = o.id;
end $$;

-- the store types the 4-digit code the BUYER shows; five wrong tries lock it
create or replace function public.merchant_deliver_order(p_order_id uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare o public.orders; c public.order_delivery_codes;
begin
  if public.is_blocked() then raise exception 'not allowed'; end if;
  select o2.* into o from public.orders o2 join public.stores s on s.id = o2.store_id
   where o2.id = p_order_id and s.owner_id = auth.uid() for update of o2;
  if not found then raise exception 'order not found'; end if;
  if o.delivery_mode <> 'store' or o.status <> 'with_courier' then raise exception 'invalid transition'; end if;
  select * into c from public.order_delivery_codes where order_id = o.id for update;
  if not found then raise exception 'invalid transition'; end if;
  if c.attempts >= 5 then return 'locked'; end if;
  if c.code <> btrim(coalesce(p_code,'')) then
    update public.order_delivery_codes set attempts = attempts + 1 where order_id = o.id;
    return 'wrong_code';
  end if;
  update public.orders set status = 'delivered' where id = o.id;
  return 'ok';
end $$;

-- the delivery failed after the order left the store (buyer unreachable, refused...): cancel with a written reason
create or replace function public.merchant_cancel_in_transit(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; v_reason text := btrim(coalesce(p_reason,''));
begin
  if public.is_blocked() then raise exception 'not allowed'; end if;
  select o2.* into o from public.orders o2 join public.stores s on s.id = o2.store_id
   where o2.id = p_order_id and s.owner_id = auth.uid() for update of o2;
  if not found then raise exception 'order not found'; end if;
  if o.delivery_mode <> 'store' or o.status <> 'with_courier' then raise exception 'invalid transition'; end if;
  if char_length(v_reason) not between 3 and 200 then raise exception 'reason required'; end if;
  update public.orders set status = 'cancelled', cancel_reason = v_reason where id = o.id;
end $$;

-- the buyer answers a proposed fee: courier orders (existing flow) and store-delivered orders
create or replace function public.customer_respond_fee(p_order_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if public.is_blocked() then raise exception 'not allowed'; end if;
  select * into o from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'order not found'; end if;
  if o.fee_status <> 'countered' or o.status in ('cancelled','delivered','with_courier') then raise exception 'invalid transition'; end if;
  if o.delivery_mode = 'store' then
    if p_accept then
      update public.orders set fee_status = 'accepted' where id = o.id;
    else
      update public.orders set fee_status = 'pending', delivery_fee = o.proposed_delivery_fee, total = o.subtotal + o.proposed_delivery_fee where id = o.id;
    end if;
  elsif o.delivery_mode = 'courier' and o.courier_id is not null then
    if p_accept then
      update public.orders set fee_status = 'accepted' where id = o.id;
    else
      insert into public.order_declines(order_id, courier_id) values (o.id, o.courier_id) on conflict do nothing;
      delete from public.order_courier_contacts where order_id = o.id;
      update public.orders set courier_id = null, courier_proposed_fee = null, courier_reply = null, fee_status = 'pending',
             delivery_fee = o.proposed_delivery_fee, total = o.subtotal + o.proposed_delivery_fee where id = o.id;
    end if;
  else
    raise exception 'invalid transition';
  end if;
end $$;

drop trigger if exists trg_notify_order_events_upd on public.orders;
create trigger trg_notify_order_events_upd after update on public.orders for each row
  when (old.status is distinct from new.status or old.fee_status is distinct from new.fee_status
        or old.courier_id is distinct from new.courier_id or old.payment_status is distinct from new.payment_status
        or old.delivery_fee is distinct from new.delivery_fee)
  execute function public.notify_order_events();

do $$ declare f text; begin
  foreach f in array array[
    'create_order(uuid,jsonb,text,text,text,uuid,numeric,text,text,numeric,uuid,double precision,double precision)',
    'merchant_set_order_status(uuid,public.order_status,integer)', 'customer_cancel_order(uuid)', 'customer_respond_fee(uuid,boolean)',
    'merchant_set_delivery_fee(uuid,numeric)', 'merchant_dispatch_order(uuid,text,text)',
    'merchant_deliver_order(uuid,text)', 'merchant_cancel_in_transit(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.expire_stale_orders() from public, anon, authenticated;
