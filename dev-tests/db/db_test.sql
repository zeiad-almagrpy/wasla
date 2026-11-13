-- DEV ONLY. DO NOT RUN IN THE SUPABASE SQL EDITOR (uses psql meta-commands and a local stand-in for auth/storage). Use run.sh.
-- Behavioural tests for schema.sql + all migrations on a LOCAL Postgres with the Supabase stand-in in stub.sql.
--   createdb wesla && psql -d wesla -f stub.sql -f ../schema.sql -f ../migrations/002_phase1.sql && psql -d wesla -v ON_ERROR_STOP=1 -f phase1_test.sql
-- Everything runs in one transaction and is rolled back at the end. Any failed assertion aborts with an error.
\set ON_ERROR_STOP on
begin;
create schema t;
create function t.as(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, true); perform set_config('role','authenticated',true); end $$;
create function t.ok(c boolean, msg text) returns void language plpgsql as $$ begin if not coalesce(c,false) then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function t.fails(q text, pat text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm ilike '%'||pat||'%' then raise notice 'pass (rejected): % [%]', pat, left(sqlerrm,70); return; end if;
    raise exception 'WRONG ERROR for [%]: got [%] wanted [%]', left(q,80), sqlerrm, pat;
  end;
  raise exception 'SHOULD HAVE FAILED: %', left(q,100);
end $$;
grant usage on schema t to public;

-- ---------- users ----------
insert into auth.users(id,email,raw_user_meta_data) values
 ('a0000000-0000-0000-0000-000000000001','admin@t.t','{"full_name":"Admin","phone":"201000000001"}'),
 ('b0000000-0000-0000-0000-000000000001','m1@t.t','{"full_name":"Merchant One","phone":"201000000011","requested_role":"merchant"}'),
 ('b0000000-0000-0000-0000-000000000002','m2@t.t','{"full_name":"Merchant Two","phone":"201000000012","requested_role":"merchant"}'),
 ('c0000000-0000-0000-0000-000000000001','c1@t.t','{"full_name":"Customer One","phone":"201000000021"}'),
 ('c0000000-0000-0000-0000-000000000002','c2@t.t','{"full_name":"Customer Two","phone":"201000000022"}'),
 ('d0000000-0000-0000-0000-000000000001','k1@t.t','{"full_name":"Courier One","phone":"201000000031","requested_role":"courier"}'),
 ('d0000000-0000-0000-0000-000000000002','k2@t.t','{"full_name":"Courier Two","phone":"201000000032","requested_role":"courier"}');
update public.profiles set role='admin' where id='a0000000-0000-0000-0000-000000000001';
update public.profiles set role='courier' where id in ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002');

select t.as('b0000000-0000-0000-0000-000000000001');
select public.register_store('محل الأول','بقالة','','شارع 1',(select id from public.regions limit 1)) as s1 \gset
select t.as('b0000000-0000-0000-0000-000000000002');
select public.register_store('محل الثاني','مخبز','','شارع 2',(select id from public.regions limit 1)) as s2 \gset
select t.as('a0000000-0000-0000-0000-000000000001');
select public.admin_set_store_status(:'s1','active');
select public.admin_set_store_status(:'s2','active');
insert into public.delivery_zones(name,fee) values ('قرية س',20);
select id as z1 from public.delivery_zones limit 1 \gset
select t.as('b0000000-0000-0000-0000-000000000001');
update public.stores set vodafone_cash_number='201000000011', own_delivery=true, own_delivery_fee=10 where id=:'s1';
insert into public.products(store_id,name,price) values (:'s1','لبن',30) returning id as p1 \gset
insert into public.products(store_id,name,price) values (:'s1','جبنة',50) returning id as p2 \gset
select t.as('b0000000-0000-0000-0000-000000000002');
insert into public.products(store_id,name,price) values (:'s2','عيش',5) returning id as p3 \gset

-- ---------- 1. fixed-zone courier order, full happy path with codes ----------
select t.as('c0000000-0000-0000-0000-000000000001');
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',2)), 'courier','المنزل 5 جنب المسجد',null,:'z1',null,'cash','بدون تغليف',60,gen_random_uuid()) as o1 \gset
select t.ok((select total from public.orders where id=:'o1')=80, 'total = 60 items + 20 zone fee (server computed)');
select t.ok((select address_snapshot from public.orders where id=:'o1')='قرية س', 'orders row only carries coarse area');
select t.ok((select count(*) from public.order_addresses where order_id=:'o1')=1, 'buyer reads own full address');
select t.ok((select code from public.order_delivery_codes where order_id=:'o1') ~ '^[0-9]{4}$', 'buyer sees delivery code');
select t.ok((select count(*) from public.order_pickup_codes where order_id=:'o1')=0, 'buyer cannot see pickup code');
select t.as('d0000000-0000-0000-0000-000000000001');
select t.ok((select count(*) from public.orders where id=:'o1')=0, 'courier cannot see order before store accepts');
select t.as('b0000000-0000-0000-0000-000000000001');
select t.ok((select count(*) from public.order_pickup_codes where order_id=:'o1')=0, 'store cannot see pickup code before accepting');
select public.merchant_set_order_status(:'o1','accepted',20);
select t.ok((select count(*) from public.order_pickup_codes where order_id=:'o1')=1, 'store sees pickup code once accepted');
select t.ok((select count(*) from public.order_delivery_codes where order_id=:'o1')=0, 'store cannot see delivery code');
select t.as('d0000000-0000-0000-0000-000000000001');
select t.ok((select count(*) from public.orders where id=:'o1')=1, 'courier sees accepted order');
select t.ok((select address_snapshot from public.orders where id=:'o1')='قرية س' and (select count(*) from public.order_addresses where order_id=:'o1')=0, 'courier sees area but NOT full address before claiming');
select t.ok((select count(*) from public.order_contacts where order_id=:'o1')=0, 'courier cannot see buyer phone before claiming');
select t.ok((select count(*) from public.order_pickup_codes where order_id=:'o1')+(select count(*) from public.order_delivery_codes where order_id=:'o1')=0, 'courier cannot read any code');
select t.fails(format('select public.courier_offer_fee(%L,25,%L)',:'o1',''), 'order not available');
select public.courier_claim_order(:'o1');
select t.ok((select count(*) from public.order_addresses where order_id=:'o1')=1 and (select count(*) from public.order_contacts where order_id=:'o1')=1, 'courier sees address + phone after claiming');
select t.as('d0000000-0000-0000-0000-000000000002');
select t.ok((select count(*) from public.orders where id=:'o1')=0, 'second courier no longer sees claimed order');
select t.as('b0000000-0000-0000-0000-000000000001');
select t.ok((select courier_name from public.order_courier_contacts where order_id=:'o1')='Courier One', 'store sees which courier is coming');
select public.merchant_set_order_status(:'o1','ready');
select code as pc from public.order_pickup_codes where order_id=:'o1' \gset
select t.as('d0000000-0000-0000-0000-000000000001');
select t.ok(public.courier_pickup_order(:'o1','0000x')='wrong_code', 'wrong pickup code rejected');
select t.ok(public.courier_pickup_order(:'o1',:'pc')='ok', 'right pickup code -> with_courier');
select t.ok((select status from public.orders where id=:'o1')='with_courier', 'status moved');
select public.courier_update_location(:'o1',31.0,30.9);
reset role;
select code as dc from public.order_delivery_codes where order_id=:'o1' \gset
select t.as('d0000000-0000-0000-0000-000000000001');
select t.ok(public.courier_deliver_order(:'o1','abcd')='wrong_code', 'wrong delivery code rejected');
select t.ok(public.courier_deliver_order(:'o1',:'dc')='ok', 'right delivery code -> delivered');
select t.ok((select count(*) from public.order_contacts where order_id=:'o1')=0 and (select count(*) from public.order_addresses where order_id=:'o1')=0, 'courier loses phone+address after delivery');
reset role;
select t.ok((select count(*) from public.notifications where order_id=:'o1' and user_id='d0000000-0000-0000-0000-000000000002')>=1, 'idle courier #2 was notified a task appeared');
select t.ok((select count(*) from public.notifications where order_id=:'o1' and body ~ '[a-z_]{6,}' and body !~ '#')=0, 'no raw english enums in notification bodies');

-- ---------- 2. lock after 5 wrong codes ----------
select t.as('c0000000-0000-0000-0000-000000000001');
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p2','qty',1)), 'courier','بيت 2',null,:'z1',null,'cash',null,null,null) as o2 \gset
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_set_order_status(:'o2','accepted',10);
select public.merchant_set_order_status(:'o2','ready');
select t.as('d0000000-0000-0000-0000-000000000001');
select public.courier_claim_order(:'o2');
select public.courier_pickup_order(:'o2','1') from generate_series(1,5);
select t.ok(public.courier_pickup_order(:'o2','1')='locked', 'pickup locked after 5 wrong attempts (even with right code)');

-- ---------- 3. admin tools for a stuck order ----------
select t.as('a0000000-0000-0000-0000-000000000001');
select public.admin_order_action(:'o2','release_courier','courier unreachable');
select t.ok((select courier_id is null and fee_status='accepted' from public.orders where id=:'o2'), 'released: courier cleared, fixed fee kept');
select t.ok((select count(*) from public.admin_audit_log where action='order_release_courier')=1, 'admin action audited');
select public.admin_order_action(:'o2','cancel','test');
select t.ok((select status from public.orders where id=:'o2')='cancelled', 'admin cancelled order');
select t.as('c0000000-0000-0000-0000-000000000001');
select t.fails(format('select public.admin_order_action(%L,%L,%L)',:'o2','cancel',''), 'not allowed');

-- ---------- 4. Vodafone Cash pickup order ----------
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)), 'pickup',null,null,null,null,'vodafone_cash',null,30,null) as o3 \gset
select t.ok((select payment_status from public.orders where id=:'o3')='awaiting' and (select total from public.orders where id=:'o3')=30, 'vodafone order starts awaiting payment');
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_set_order_status(:'o3','accepted',5);
select public.merchant_set_order_status(:'o3','ready');
select t.fails(format('select public.merchant_set_order_status(%L,%L)',:'o3','delivered'), 'payment pending');
select t.as('c0000000-0000-0000-0000-000000000001');
select public.customer_submit_payment(:'o3','TX12345');
select t.fails(format('select public.customer_cancel_order(%L)',:'o3'), 'invalid transition');
select t.as('c0000000-0000-0000-0000-000000000002');
select t.fails(format('select public.customer_submit_payment(%L,%L)',:'o3','HACK123'), 'order not found');
select t.as('b0000000-0000-0000-0000-000000000002');
select t.fails(format('select public.merchant_review_payment(%L,true)',:'o3'), 'order not found');
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_review_payment(:'o3',true);
select public.merchant_set_order_status(:'o3','delivered');
select t.ok((select status from public.orders where id=:'o3')='delivered', 'pickup order delivered after payment confirmed');

-- ---------- 5. store's own delivery ----------
select t.as('c0000000-0000-0000-0000-000000000001');
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)), 'store','بيت 9',null,null,null,'cash',null,30,null) as o4 \gset
select t.ok((select delivery_fee from public.orders where id=:'o4')=10 and (select fee_status from public.orders where id=:'o4')='pending' and not (select fee_fixed from public.orders where id=:'o4'), 'store delivery starts with the usual fee as an estimate, still pending the store''s own fee');
select t.ok((select code from public.order_delivery_codes where order_id=:'o4') ~ '^[0-9]{4}$', 'buyer sees a delivery code for store-delivered orders');
select t.as('b0000000-0000-0000-0000-000000000001');
select t.ok((select count(*) from public.order_delivery_codes where order_id=:'o4')=0, 'the store can NEVER read the buyer delivery code');
select public.merchant_set_order_status(:'o4','accepted',5);
select t.as('d0000000-0000-0000-0000-000000000002');
select t.ok((select count(*) from public.orders where id=:'o4')=0, 'couriers never see store-delivered orders');
select t.fails(format('select public.courier_claim_order(%L)',:'o4'), 'order not available');
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_set_order_status(:'o4','ready');
select t.fails(format('select public.merchant_dispatch_order(%L)',:'o4'), 'fee not agreed');
select t.fails(format('select public.merchant_set_order_status(%L,%L)',:'o4','with_courier'), 'invalid transition');
select t.fails(format('select public.merchant_set_delivery_fee(%L,%s)',:'o4',9999), 'invalid fee');
select public.merchant_set_delivery_fee(:'o4',10);
select t.ok((select fee_status from public.orders where id=:'o4')='accepted', 'proposing exactly the usual fee the buyer already saw is auto-approved');
select t.fails(format('select public.merchant_set_delivery_fee(%L,%s)',:'o4',12), 'invalid transition');
select t.fails(format('select public.merchant_dispatch_order(%L,%L,%L)',:'o4','سواق','12'), 'invalid phone');
select public.merchant_dispatch_order(:'o4','أحمد السواق','01012345678');
select t.ok((select status::text='with_courier' and store_courier_name='أحمد السواق' and store_courier_phone='01012345678' from public.orders where id=:'o4'), 'store dispatched, driver name/phone saved');
select t.fails(format('select public.merchant_set_order_status(%L,%L)',:'o4','delivered'), 'invalid transition');
select t.ok(public.merchant_deliver_order(:'o4','abcd')='wrong_code', 'wrong buyer code does not deliver');
select t.as('b0000000-0000-0000-0000-000000000002');
select t.fails(format('select public.merchant_deliver_order(%L,%L)',:'o4','0000'), 'order not found');
select t.as('c0000000-0000-0000-0000-000000000001');
select code as o4code from public.order_delivery_codes where order_id=:'o4' \gset
select t.as('b0000000-0000-0000-0000-000000000001');
select t.ok(public.merchant_deliver_order(:'o4',:'o4code')='ok', 'right buyer code delivers the store order');
select t.ok((select status from public.orders where id=:'o4')='delivered', 'store order delivered with the buyer code');

-- 5b. per-order fee negotiated with the buyer + wrong-code lock + cancel in transit
select t.as('c0000000-0000-0000-0000-000000000001');
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)), 'store','بيت 12',null,null,null,'cash',null,30,null) as o9 \gset
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_set_delivery_fee(:'o9',25);
select public.merchant_set_order_status(:'o9','accepted',5);
select t.ok((select fee_status='countered' and delivery_fee=25 and total=55 from public.orders where id=:'o9'), 'store fee proposal changes the total, waits for buyer');
reset role;
select t.ok((select count(*) from public.notifications where user_id='c0000000-0000-0000-0000-000000000001' and title='المحل حدد أجرة التوصيل' and order_id=:'o9')=1, 'buyer notified about the store fee');
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_set_order_status(:'o9','ready');
select t.fails(format('select public.merchant_dispatch_order(%L)',:'o9'), 'fee not agreed');
select t.as('c0000000-0000-0000-0000-000000000002');
select t.fails(format('select public.customer_respond_fee(%L,true)',:'o9'), 'order not found');
select t.as('c0000000-0000-0000-0000-000000000001');
select public.customer_respond_fee(:'o9',false);
select t.ok((select fee_status='pending' and delivery_fee=10 and total=40 from public.orders where id=:'o9'), 'buyer rejects: fee back to the usual estimate, store must propose again');
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_set_delivery_fee(:'o9',30);
select t.as('c0000000-0000-0000-0000-000000000001');
select public.customer_respond_fee(:'o9',true);
select t.ok((select fee_status='accepted' and delivery_fee=30 and total=60 from public.orders where id=:'o9'), 'buyer accepts the new fee');
select t.fails(format('select public.customer_respond_fee(%L,true)',:'o9'), 'invalid transition');
select t.fails(format('select public.customer_cancel_order(%L)',:'o9'), 'invalid transition');  -- fee agreed and no longer fresh: cannot cancel from the app
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_dispatch_order(:'o9');
select t.ok(public.merchant_deliver_order(:'o9','a1b2')='wrong_code' and public.merchant_deliver_order(:'o9','0a0a')='wrong_code' and public.merchant_deliver_order(:'o9','0b0b')='wrong_code'
        and public.merchant_deliver_order(:'o9','0c0c')='wrong_code' and public.merchant_deliver_order(:'o9','0d0d')='wrong_code', 'five wrong tries');
select t.ok(public.merchant_deliver_order(:'o9','0000')='locked', 'code locks after 5 wrong tries (even the right code cannot unlock)');
select t.fails(format('select public.merchant_cancel_in_transit(%L,%L)',:'o9','x'), 'reason required');
select public.merchant_cancel_in_transit(:'o9','المشتري لا يرد على التليفون');
select t.ok((select status::text='cancelled' and cancel_reason like 'المشتري%' from public.orders where id=:'o9'), 'store cancels an in-transit order with a reason');

-- 5c. buyer can walk away while the store has not fixed a fee yet
select t.as('c0000000-0000-0000-0000-000000000001');
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)), 'store','بيت 13',null,null,null,'cash',null,30,null) as o10 \gset
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_set_order_status(:'o10','accepted',5);
select public.merchant_set_order_status(:'o10','preparing');
select t.as('c0000000-0000-0000-0000-000000000001');
select public.customer_cancel_order(:'o10');
select t.ok((select status from public.orders where id=:'o10')='cancelled', 'buyer can cancel a store order while the fee is not agreed');

-- 5d. a buyer who ignores the store's fee proposal for 30 min (nothing paid) -> the order is cancelled automatically
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)), 'store','بيت 14',null,null,null,'cash',null,30,null) as o11 \gset
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_set_delivery_fee(:'o11',40);
select public.merchant_set_order_status(:'o11','accepted',5);
reset role;
set local session_replication_role = replica;
update public.orders set updated_at = now() - interval '1 hour' where id=:'o11';
set local session_replication_role = origin;
select public.expire_stale_orders();
select t.ok((select status::text from public.orders where id=:'o11')='cancelled', 'ignored store fee proposal expires after 30 minutes');
select t.as('c0000000-0000-0000-0000-000000000001');
select t.as('c0000000-0000-0000-0000-000000000001');
select t.fails(format('select public.create_order(%L,%L::jsonb,%L,%L,null,null,null,%L,null,null,null)',:'s2',jsonb_build_array(jsonb_build_object('product_id',:'p3','qty',1)),'store','x y z','cash'), 'delivery unavailable');
select t.fails(format('select public.create_order(%L,%L::jsonb,%L,null,null,null,null,%L,null,null,null)',:'s2',jsonb_build_array(jsonb_build_object('product_id',:'p3','qty',1)),'pickup','vodafone_cash'), 'payment unavailable');

-- ---------- 6. negotiated fee flow ----------
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)), 'courier','بيت 3','قرية ص',null,15,'cash',null,null,null) as o5 \gset
select t.ok((select fee_status from public.orders where id=:'o5')='pending' and not (select fee_fixed from public.orders where id=:'o5'), 'no zone -> negotiable');
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_set_order_status(:'o5','accepted',15);
select t.as('d0000000-0000-0000-0000-000000000001');
select public.courier_offer_fee(:'o5',25,'مسافة بعيدة');
select t.as('d0000000-0000-0000-0000-000000000002');
select t.ok((select count(*) from public.orders where id=:'o5')=0, 'order hidden from others while an offer is pending');
reset role;
select t.ok((select count(*) from public.notifications where user_id='c0000000-0000-0000-0000-000000000001' and title='المندوب اقترح أجرة')=1, 'buyer notified about counter offer');
select t.as('c0000000-0000-0000-0000-000000000001');
select public.customer_respond_fee(:'o5',false);
select t.as('d0000000-0000-0000-0000-000000000001');
select t.ok((select count(*) from public.orders where id=:'o5')=0, 'rejected courier does not see it again');
select t.as('d0000000-0000-0000-0000-000000000002');
select public.courier_offer_fee(:'o5',15,'');
select t.ok((select fee_status from public.orders where id=:'o5')='accepted', 'matching the proposed fee is accepted');

-- ---------- 7. timeouts ----------
select t.as('c0000000-0000-0000-0000-000000000002');
select public.create_order(:'s2', jsonb_build_array(jsonb_build_object('product_id',:'p3','qty',3)), 'pickup',null,null,null,null,'cash',null,15,null) as o6 \gset
reset role;
update public.orders set created_at = now() - interval '2 hours' where id=:'o6';
select public.expire_stale_orders() as exp \gset
select t.ok(:exp>=1 and (select status from public.orders where id=:'o6')='cancelled', 'new order auto-cancelled after timeout');
select t.as('c0000000-0000-0000-0000-000000000002');
select t.fails(format('select public.expire_stale_orders()'), 'permission denied');

-- ---------- 8. price change, idempotency, limits, store closed, phone ----------
select t.as('c0000000-0000-0000-0000-000000000001');
select t.fails(format('select public.create_order(%L,%L::jsonb,%L,null,null,null,null,%L,null,29,null)',:'s1',jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)),'pickup','cash'), 'price changed');
select t.ok((select count(*) from public.orders where customer_id='c0000000-0000-0000-0000-000000000001')=8, 'failed order left nothing behind');
select gen_random_uuid() as k1 \gset
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)), 'pickup',null,null,null,null,'cash',null,30,:'k1') as oi1 \gset
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)), 'pickup',null,null,null,null,'cash',null,30,:'k1') as oi2 \gset
select t.ok(:'oi1'=:'oi2' and (select count(*) from public.orders where idempotency_key=:'k1')=1, 'same idempotency key -> one order');
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)), 'pickup',null,null,null,null,'cash',null,30,null);
select t.fails(format('select public.create_order(%L,%L::jsonb,%L,null,null,null,null,%L,null,null,null)',:'s1',jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)),'pickup','cash'), 'too many open orders');
-- customer can cancel a new order, and an accepted one only inside 3 minutes
select t.ok((select count(*) from public.orders where id=:'oi1')=1, 'own order visible');
select public.customer_cancel_order(:'oi1');
select t.ok((select status from public.orders where id=:'oi1')='cancelled', 'customer cancels a new order');
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_set_order_status((select id from public.orders where customer_id='c0000000-0000-0000-0000-000000000001' and status='new' limit 1),'accepted',5) ;
select t.as('c0000000-0000-0000-0000-000000000001');
select public.customer_cancel_order((select id from public.orders where customer_id='c0000000-0000-0000-0000-000000000001' and status='accepted' and payment_status='cod' and delivery_mode='pickup' limit 1));
select t.ok(true, 'cancel allowed right after accept (within 3 min, no courier)');

-- store closed / phone required
select t.as('b0000000-0000-0000-0000-000000000001');
update public.stores set is_open=false where id=:'s1';
select t.as('c0000000-0000-0000-0000-000000000002');
select t.fails(format('select public.create_order(%L,%L::jsonb,%L,null,null,null,null,%L,null,null,null)',:'s1',jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)),'pickup','cash'), 'store closed');
select t.ok((select count(*) from public.stores where id=:'s1')=1, 'closed store still listed');
select t.as('b0000000-0000-0000-0000-000000000001');
update public.stores set is_open=true where id=:'s1';
reset role;
update public.profiles set phone=null where id='c0000000-0000-0000-0000-000000000002';
select t.as('c0000000-0000-0000-0000-000000000002');
select t.fails(format('select public.create_order(%L,%L::jsonb,%L,null,null,null,null,%L,null,null,null)',:'s1',jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)),'pickup','cash'), 'phone required');
reset role;
update public.profiles set phone='201000000022' where id='c0000000-0000-0000-0000-000000000002';

-- ---------- 9. direct-write attacks ----------
-- earlier admin calls set wesla.bypass for the rest of THIS transaction; real requests each get a fresh one, so reset it
reset role;
select set_config('wesla.bypass','',true);
select t.as('c0000000-0000-0000-0000-000000000001');
select t.fails(format('insert into public.orders(customer_id,store_id,subtotal,total) values (%L,%L,0,0)','c0000000-0000-0000-0000-000000000001',:'s1'), 'row-level security');
with u as (update public.orders set total=1 where id=:'o1' returning 1) select t.ok((select count(*) from u)=0, 'buyer cannot edit orders directly');
select t.fails($$update public.profiles set role='admin' where id='c0000000-0000-0000-0000-000000000001'$$, 'not allowed');
select t.fails($$update public.profiles set phone='201999999999' where id='c0000000-0000-0000-0000-000000000001'$$, 'not allowed');
select t.fails(format('insert into storage.objects(bucket_id,name) values (%L,%L)','images','c0000000-0000-0000-0000-000000000002/x.jpg'), 'row-level security');
select t.as('b0000000-0000-0000-0000-000000000001');
select t.fails(format('update public.stores set status=%L where id=%L','paused',:'s1'), 'not allowed');
select t.fails(format('update public.stores set paid_until=current_date+400 where id=%L',:'s1'), 'not allowed');
select t.as('b0000000-0000-0000-0000-000000000002');
with u as (update public.products set price=1 where id=:'p1' returning 1) select t.ok((select count(*) from u)=0, 'other merchant cannot reprice my product');
select t.fails(format('select public.merchant_set_order_status(%L,%L)',:'o5','cancelled'), 'order not found');
select t.as('d0000000-0000-0000-0000-000000000001');
select t.fails(format('select public.merchant_set_order_status(%L,%L)',:'o5','ready'), 'order not found');

-- ---------- 10. community board abuse ----------
select t.as('c0000000-0000-0000-0000-000000000001');
insert into public.request_posts(title) values ('أبحث عن شاحن') returning id as post1 \gset
select t.fails(format('update public.request_posts set author_name=%L where id=%L','إدارة وصلة',:'post1'), 'not allowed');
select t.ok((select author_name from public.request_posts where id=:'post1')='Customer One', 'author name filled by server');
insert into public.request_posts(title) select 'x'||g from generate_series(1,4) g;
select t.fails($$insert into public.request_posts(title) values ('one too many')$$, 'rate limit');

-- ---------- 11. support replies ----------
insert into public.support_requests(user_id,subject,message) values ('c0000000-0000-0000-0000-000000000001','مشكلة','الطلب اتأخر') returning id as sup1 \gset
select t.as('a0000000-0000-0000-0000-000000000001');
select t.ok((select count(*) from public.support_requests s join public.profiles p on p.id=s.user_id where s.id=:'sup1' and p.phone is not null)=1, 'admin can resolve sender name/phone for a ticket');
select public.admin_reply_support(:'sup1','تم حل المشكلة');
select t.as('c0000000-0000-0000-0000-000000000001');
select t.ok((select admin_reply from public.support_requests where id=:'sup1')='تم حل المشكلة' and (select count(*) from public.notifications where title='رد من إدارة وصلة')=1, 'buyer sees reply + notification');

-- ---------- 11b. shared GPS location + "ready right away" (migration 003) ----------
select t.as('c0000000-0000-0000-0000-000000000002');
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)), 'courier','بيت 9 جنب الفرن',null,:'z1',null,'cash',null,30,null, 31.2, 30.9) as o7 \gset
select t.ok((select lat from public.order_addresses where order_id=:'o7')=31.2 and (select lng from public.order_addresses where order_id=:'o7')=30.9, 'buyer can attach a GPS location to the order');
select t.fails(format('select public.create_order(%L,%L::jsonb,%L,%L,null,%L,null,%L,null,null,null,31.2,null)',:'s1',jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)),'courier','بيت 9 جنب الفرن',:'z1','cash'), 'invalid location');
select t.fails(format('select public.create_order(%L,%L::jsonb,%L,%L,null,%L,null,%L,null,null,null,120,10)',:'s1',jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)),'courier','بيت 9 جنب الفرن',:'z1','cash'), 'invalid location');
select t.as('c0000000-0000-0000-0000-000000000001');
select t.ok((select count(*) from public.order_addresses where order_id=:'o7')=0, 'another buyer cannot read the location');
select t.as('b0000000-0000-0000-0000-000000000002');
select t.ok((select count(*) from public.order_addresses where order_id=:'o7')=0, 'another store cannot read the location');
select t.as('b0000000-0000-0000-0000-000000000001');
select t.ok((select lat from public.order_addresses where order_id=:'o7')=31.2, 'the order''s own store sees the pin');
select public.merchant_set_order_status(:'o7','ready');
select t.ok((select status::text='ready' and accepted_at is not null from public.orders where id=:'o7'), 'new -> ready directly ("ready right away")');
reset role;
select t.ok((select count(*) from public.notifications where order_id=:'o7' and title='مهمة توصيل جديدة')>=1, 'idle couriers are alerted for a ready-right-away order');
select t.as('d0000000-0000-0000-0000-000000000001');
select t.ok((select count(*) from public.order_addresses where order_id=:'o7')=0, 'courier cannot see the pin before claiming');
select public.courier_claim_order(:'o7');
select t.ok((select lng from public.order_addresses where order_id=:'o7')=30.9, 'after claiming, the courier sees the pin');
select t.as('c0000000-0000-0000-0000-000000000002');
select public.create_order(:'s1', jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)), 'pickup',null,null,null,null,'cash',null,30,null) as o8 \gset
select t.as('b0000000-0000-0000-0000-000000000001');
select public.merchant_set_order_status(:'o8','ready');
select public.merchant_set_order_status(:'o8','delivered');
select t.ok((select status::text from public.orders where id=:'o8')='delivered', 'pickup order: ready right away then handed over');

-- ---------- 11c. phone login support + admin password reset (migration 004) ----------
reset role;
insert into auth.users(id,email,phone,raw_user_meta_data) values ('e0000000-0000-0000-0000-000000000001', null, '201055500001', '{"full_name":"Phone Only"}');
select t.ok((select phone from public.profiles where id='e0000000-0000-0000-0000-000000000001')='201055500001', 'profile phone is taken from the auth phone when metadata has none');
insert into auth.sessions(user_id) values ('e0000000-0000-0000-0000-000000000001');
select t.as('c0000000-0000-0000-0000-000000000001');
select t.fails($$select public.admin_reset_password('e0000000-0000-0000-0000-000000000001')$$, 'not allowed');
select t.as('a0000000-0000-0000-0000-000000000001');
select public.admin_reset_password('e0000000-0000-0000-0000-000000000001') as temp_pw \gset
reset role;   -- clients can never read auth.users; verify as the owner
select t.ok(:'temp_pw' ~ '^[a-hj-km-np-z2-9]{8}$', 'temporary password is 8 unambiguous characters');
select t.ok((select encrypted_password = extensions.crypt(:'temp_pw', encrypted_password) from auth.users where id='e0000000-0000-0000-0000-000000000001'), 'the new password hash matches the temporary password');
select t.ok((select must_change_password from public.profiles where id='e0000000-0000-0000-0000-000000000001'), 'user is forced to choose a new password');
select t.ok((select count(*) from auth.sessions where user_id='e0000000-0000-0000-0000-000000000001')=0, 'old sessions are revoked');
select t.ok((select count(*) from public.admin_audit_log where action='user_reset_password')=1, 'reset is audited (and the password itself is NOT logged)');
select t.as('a0000000-0000-0000-0000-000000000001');
select t.fails($$select public.admin_reset_password('00000000-0000-0000-0000-00000000dead')$$, 'user not found');
select public.admin_reset_password('e0000000-0000-0000-0000-000000000001') as temp_pw2 \gset
select t.ok(:'temp_pw' <> :'temp_pw2', 'each reset yields a fresh password');
reset role;
select t.as('e0000000-0000-0000-0000-000000000001');
update public.profiles set must_change_password = false where id='e0000000-0000-0000-0000-000000000001';
select t.ok(not (select must_change_password from public.profiles where id='e0000000-0000-0000-0000-000000000001'), 'user clears the flag after changing the password');

-- ---------- 12. subscriptions ----------
select t.as('a0000000-0000-0000-0000-000000000001');
select public.admin_extend_subscription(:'s2',2,150);
select t.ok((select paid_until from public.stores where id=:'s2')>current_date+55 and (select subscription_status from public.stores where id=:'s2')='active', 'extend sets paid_until + active');
select t.ok((select count(*) from public.subscription_payments where store_id=:'s2')=1, 'payment recorded');
insert into public.platform_settings(key,value) values ('enforce_subscription','true') on conflict (key) do update set value='true';
select t.ok((select count(*) from public.admin_audit_log where action like '%platform_settings')>=1, 'settings write audited');
reset role;
update public.stores set subscription_status='expired' where id=:'s1';
select t.as('c0000000-0000-0000-0000-000000000001');
select t.fails(format('select public.create_order(%L,%L::jsonb,%L,null,null,null,null,%L,null,null,null)',:'s1',jsonb_build_array(jsonb_build_object('product_id',:'p1','qty',1)),'pickup','cash'), 'store unavailable');
reset role;
update public.stores set paid_until=current_date-1 where id=:'s2';
select public.expire_subscriptions();
select t.ok((select subscription_status from public.stores where id=:'s2')='expired', 'lapsed paid_until -> expired by the daily job');

do $$ begin raise notice '=== ALL PHASE-1 TESTS PASSED ==='; end $$;
rollback;
