-- WESLA migration 003. Requires 002. Safe to re-run.
--  * buyer can share his GPS location with an order (visible only to the store and the courier who took the order)
--  * the store can mark a new order "ready right away" (no prep time needed)
--  * old pickup orders get a proper area label

alter table public.order_addresses add column if not exists lat double precision;
alter table public.order_addresses add column if not exists lng double precision;
do $$ begin
  alter table public.order_addresses add constraint order_addr_loc_chk
    check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180));
exception when duplicate_object then null; end $$;

update public.orders set area_hint = 'استلام من المحل', address_snapshot = case when address_snapshot = '' then 'استلام من المحل' else address_snapshot end
 where delivery_mode = 'pickup' and area_hint = '';

drop function if exists public.create_order(uuid, jsonb, text, text, text, uuid, numeric, text, text, numeric, uuid);
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
      v_fee := coalesce(v_store.own_delivery_fee, 0); v_fixed := true; v_area := 'توصيل من المحل';
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
          case when p_mode = 'courier' and not v_fixed then 'pending' else 'accepted' end,
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
  if p_mode = 'courier' then
    insert into public.order_pickup_codes(order_id, code) values (v_order, lpad((floor(random() * 10000))::int::text, 4, '0'));
    insert into public.order_delivery_codes(order_id, code) values (v_order, lpad((floor(random() * 10000))::int::text, 4, '0'));
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
     or (o.status = 'ready' and p_status = 'with_courier' and o.delivery_mode = 'store')
     or (o.status = 'with_courier' and p_status = 'delivered' and o.delivery_mode = 'store');
  if not ok then raise exception 'invalid transition'; end if;
  if p_status in ('delivered','with_courier') and o.delivery_mode in ('pickup','store') and o.payment_status not in ('cod','confirmed') then raise exception 'payment pending'; end if;
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
  if new.fee_status is distinct from old.fee_status then
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

revoke all on function public.create_order(uuid,jsonb,text,text,text,uuid,numeric,text,text,numeric,uuid,double precision,double precision) from public, anon;
grant execute on function public.create_order(uuid,jsonb,text,text,text,uuid,numeric,text,text,numeric,uuid,double precision,double precision) to authenticated;
revoke all on function public.merchant_set_order_status(uuid,public.order_status,integer) from public, anon;
grant execute on function public.merchant_set_order_status(uuid,public.order_status,integer) to authenticated;
