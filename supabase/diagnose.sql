-- READ-ONLY. Paste into the Supabase SQL Editor and run. It changes nothing.
-- Shows which parts of WESLA migrations 002 + 003 are applied. Send me the rows that say MISSING.
with checks(area, item, ok) as (values
  ('002 columns','orders.order_no',            exists(select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='order_no')),
  ('002 columns','orders.delivery_mode',       exists(select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='delivery_mode')),
  ('002 columns','orders.payment_status',      exists(select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='payment_status')),
  ('002 columns','stores.is_open',             exists(select 1 from information_schema.columns where table_schema='public' and table_name='stores' and column_name='is_open')),
  ('002 columns','stores.vodafone_cash_number',exists(select 1 from information_schema.columns where table_schema='public' and table_name='stores' and column_name='vodafone_cash_number')),
  ('002 columns','support_requests.admin_reply',exists(select 1 from information_schema.columns where table_schema='public' and table_name='support_requests' and column_name='admin_reply')),
  ('002 tables','delivery_zones',              to_regclass('public.delivery_zones') is not null),
  ('002 tables','order_addresses',             to_regclass('public.order_addresses') is not null),
  ('002 tables','order_pickup_codes',          to_regclass('public.order_pickup_codes') is not null),
  ('002 tables','order_delivery_codes',        to_regclass('public.order_delivery_codes') is not null),
  ('002 tables','subscription_payments',       to_regclass('public.subscription_payments') is not null),
  ('002 functions','courier_claim_order',      to_regprocedure('public.courier_claim_order(uuid)') is not null),
  ('002 functions','courier_pickup_order(uuid,text)', to_regprocedure('public.courier_pickup_order(uuid,text)') is not null),
  ('002 functions','courier_deliver_order(uuid,text)',to_regprocedure('public.courier_deliver_order(uuid,text)') is not null),
  ('002 functions','customer_submit_payment',  to_regprocedure('public.customer_submit_payment(uuid,text)') is not null),
  ('002 functions','merchant_review_payment',  to_regprocedure('public.merchant_review_payment(uuid,boolean)') is not null),
  ('002 functions','admin_order_action',       to_regprocedure('public.admin_order_action(uuid,text,text)') is not null),
  ('002 functions','admin_reply_support',      to_regprocedure('public.admin_reply_support(uuid,text)') is not null),
  ('002 functions','admin_extend_subscription',to_regprocedure('public.admin_extend_subscription(uuid,integer,numeric)') is not null),
  ('002 functions','notify_order_events trigger', exists(select 1 from pg_trigger where tgname='trg_notify_order_events_upd' and not tgisinternal)),
  ('002 old leftovers','old create_order(5 args) is GONE', to_regprocedure('public.create_order(uuid,jsonb,boolean,text,numeric)') is null),
  ('003','order_addresses.lat',                exists(select 1 from information_schema.columns where table_schema='public' and table_name='order_addresses' and column_name='lat')),
  ('003','create_order with location (13 args)', to_regprocedure('public.create_order(uuid,jsonb,text,text,text,uuid,numeric,text,text,numeric,uuid,double precision,double precision)') is not null),
  ('003','merchant_set_order_status(uuid,status,int)', to_regprocedure('public.merchant_set_order_status(uuid,public.order_status,integer)') is not null),
  ('storage','public listing policy removed', not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='images public read')),
  ('storage','owner-only read policy present', exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='images owner read')),
  ('realtime','orders in publication',        exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders')),
  ('realtime','notifications in publication', exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications')),
  ('cron','pg_cron extension enabled',        exists(select 1 from pg_extension where extname='pg_cron'))
)
select area, item, case when ok then 'OK' else 'MISSING' end as status from checks order by (ok), area, item;
