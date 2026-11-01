-- WESLA database v1.0 (fresh Supabase project). Run the whole file in the SQL Editor of a TEST project first.
-- Security model: the browser can READ what RLS allows, but every WRITE to orders / stores status / roles goes through
-- the security-definer functions at the bottom. Prices, totals and order states are decided on the server only.

create extension if not exists pgcrypto;

do $$ begin create type public.app_role as enum ('customer','merchant','courier','admin'); exception when duplicate_object then null; end $$;
do $$ begin create type public.store_status as enum ('pending','active','paused','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.order_status as enum ('new','accepted','preparing','ready','with_courier','delivered','cancelled'); exception when duplicate_object then null; end $$;

-- ===== tables =====
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text unique check (phone is null or phone ~ '^[0-9]{10,15}$'),
  role public.app_role not null default 'customer',
  requested_role text not null default 'customer' check (requested_role in ('customer','merchant','courier')),
  is_blocked boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  city text not null check (char_length(city) between 1 and 60), governorate text not null default '',
  is_active boolean not null default true, created_at timestamptz not null default now(), unique (city, governorate)
);
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id),
  name text not null check (char_length(name) between 2 and 80),
  description text check (description is null or char_length(description) <= 500),
  category text not null check (char_length(category) between 1 and 40),
  address text check (address is null or char_length(address) <= 200),
  region_id uuid references public.regions(id),
  status public.store_status not null default 'pending',
  trial_started_at timestamptz, subscription_status text not null default 'trial',
  monthly_price numeric(10,2) check (monthly_price is null or monthly_price >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text check (description is null or char_length(description) <= 500),
  category text check (category is null or char_length(category) <= 40),
  price numeric(10,2) not null check (price > 0 and price <= 100000),
  is_available boolean not null default true, image_path text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  store_id uuid not null references public.stores(id),
  address_snapshot text not null default '' check (char_length(address_snapshot) <= 300),
  status public.order_status not null default 'new',
  subtotal numeric(10,2) not null check (subtotal >= 0),
  proposed_delivery_fee numeric(10,2) not null default 0 check (proposed_delivery_fee between 0 and 500),
  courier_proposed_fee numeric(10,2) check (courier_proposed_fee is null or courier_proposed_fee between 0 and 500),
  courier_reply text check (courier_reply is null or char_length(courier_reply) <= 300),
  fee_status text not null default 'pending' check (fee_status in ('pending','countered','accepted','declined')),
  courier_id uuid references public.profiles(id),
  courier_lat double precision check (courier_lat between -90 and 90),
  courier_lng double precision check (courier_lng between -180 and 180),
  delivery_required boolean not null default true,
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  total numeric(10,2) not null check (total >= 0),
  payment_method text not null default 'cash',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.orders add column if not exists courier_lat double precision;
alter table public.orders add column if not exists courier_lng double precision;
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name_snapshot text not null,
  unit_price_snapshot numeric(10,2) not null check (unit_price_snapshot >= 0),
  quantity integer not null check (quantity > 0),
  line_total numeric(10,2) not null check (line_total >= 0),
  image_path_snapshot text
);
-- buyer contact is kept apart so it can be shown only to the right people
create table if not exists public.order_contacts (
  order_id uuid primary key references public.orders(id) on delete cascade,
  customer_name text not null, customer_phone text not null
);
create table if not exists public.order_declines (
  order_id uuid not null references public.orders(id) on delete cascade,
  courier_id uuid not null references public.profiles(id) on delete cascade,
  primary key (order_id, courier_id)
);
create table if not exists public.request_posts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  author_name text not null default '',
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  image_path text, status text not null default 'open' check (status in ('open','found','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.request_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.request_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  author_name text not null default '', author_role text not null default 'customer',
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 3000),
  image_path text, status text not null default 'published' check (status in ('draft','published','archived')),
  published_at timestamptz default now(), created_at timestamptz not null default now()
);
create table if not exists public.platform_settings (
  key text primary key, value text not null default '', updated_at timestamptz not null default now()
);
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id),
  action text not null, target_type text, target_id text, details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, body text not null, order_id uuid references public.orders(id) on delete cascade,
  is_read boolean not null default false, created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);
create or replace function public.notify_order_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_title text; v_body text;
begin
  if new.status is distinct from old.status then
    v_title := 'تحديث الطلب';
    v_body := 'حالة الطلب #' || right(new.id::text, 6) || ' أصبحت: ' || new.status::text;
    insert into public.notifications(user_id,title,body,order_id) values (new.customer_id,v_title,v_body,new.id);
    insert into public.notifications(user_id,title,body,order_id)
      select owner_id,v_title,v_body,new.id from public.stores where id=new.store_id and owner_id<>new.customer_id;
    if new.courier_id is not null and new.courier_id<>new.customer_id then
      insert into public.notifications(user_id,title,body,order_id) values (new.courier_id,v_title,v_body,new.id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_order_status on public.orders;
create trigger trg_notify_order_status after update of status on public.orders
for each row execute function public.notify_order_status_change();

create index if not exists idx_products_store on public.products(store_id);
create index if not exists idx_orders_customer on public.orders(customer_id);
create index if not exists idx_orders_store on public.orders(store_id);
create index if not exists idx_orders_courier on public.orders(courier_id);
create index if not exists idx_orders_created on public.orders(created_at desc);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_comments_post on public.request_comments(post_id);

-- ===== upgrade path: if an older WESLA schema already exists, bring its tables up to date =====
alter table public.profiles add column if not exists requested_role text not null default 'customer';
alter table public.profiles add column if not exists is_blocked boolean not null default false;
alter table public.request_posts add column if not exists author_name text not null default '';
alter table public.request_comments add column if not exists author_name text not null default '';
alter table public.request_comments add column if not exists author_role text not null default 'customer';
create unique index if not exists uq_stores_owner on public.stores(owner_id);
drop trigger if exists trg_promote_store_owner on public.stores;
drop function if exists public.promote_store_owner();

insert into public.regions(city, governorate) values ('مطوبس','كفر الشيخ') on conflict do nothing;
alter table public.stores drop column if exists whatsapp;
delete from public.platform_settings where key = 'support_whatsapp';

alter table public.profiles enable row level security;
alter table public.regions enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_contacts enable row level security;
alter table public.order_declines enable row level security;
alter table public.request_posts enable row level security;
alter table public.request_comments enable row level security;
alter table public.announcements enable row level security;
alter table public.platform_settings enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.notifications enable row level security;

-- ===== helpers =====
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and not p.is_blocked);
$$;
create or replace function public.has_role(r public.app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = r and not p.is_blocked);
$$;
create or replace function public.is_blocked() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_blocked from public.profiles p where p.id = auth.uid()), true);
$$;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.has_role(public.app_role) to anon, authenticated;
grant execute on function public.is_blocked() to anon, authenticated;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['profiles','stores','products','orders','request_posts'] loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I; create trigger trg_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- profile is created on signup; the role is NEVER taken from user metadata (only a harmless "requested_role" flag)
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare v_phone text := new.raw_user_meta_data->>'phone'; v_req text := new.raw_user_meta_data->>'requested_role';
begin
  if v_phone is null or v_phone !~ '^[0-9]{10,15}$' then v_phone := null; end if;
  if v_req is null or v_req not in ('customer','merchant','courier') then v_req := 'customer'; end if;
  insert into public.profiles(id, full_name, phone, requested_role)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name',''), 80), v_phone, v_req)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- role / block flag can only change through admin functions (which set wesla.bypass) or from the SQL editor (auth.uid() is null)
create or replace function public.guard_profile_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('wesla.bypass', true), '') <> '1' and auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.is_blocked is distinct from old.is_blocked
       or new.id is distinct from old.id or new.phone is distinct from old.phone then
      raise exception 'not allowed';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_profile_update on public.profiles;
create trigger trg_guard_profile_update before update on public.profiles for each row execute function public.guard_profile_update();

create or replace function public.guard_store_update() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('wesla.bypass', true), '') <> '1' and auth.uid() is not null and not public.is_admin() then
    if new.owner_id is distinct from old.owner_id or new.status is distinct from old.status
       or new.subscription_status is distinct from old.subscription_status
       or new.monthly_price is distinct from old.monthly_price
       or new.trial_started_at is distinct from old.trial_started_at then
      raise exception 'not allowed';
    end if;
  end if;
  if new.status = 'active' and old.status is distinct from 'active' and new.trial_started_at is null then
    new.trial_started_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_store_update on public.stores;
create trigger trg_guard_store_update before update on public.stores for each row execute function public.guard_store_update();

-- author name/role are filled by the server, never trusted from the browser
create or replace function public.fill_author() returns trigger language plpgsql security definer set search_path = public as $$
declare p public.profiles; v_store text;
begin
  select * into p from public.profiles where id = auth.uid();
  if tg_table_name = 'request_posts' then
    new.customer_id := auth.uid(); new.author_name := p.full_name;
  else
    new.user_id := auth.uid(); new.author_role := p.role::text;
    select name into v_store from public.stores where owner_id = auth.uid() and status = 'active';
    new.author_name := case when p.role = 'merchant' and v_store is not null then v_store else p.full_name end;
  end if;
  return new;
end $$;
drop trigger if exists trg_fill_author_posts on public.request_posts;
create trigger trg_fill_author_posts before insert on public.request_posts for each row execute function public.fill_author();
drop trigger if exists trg_fill_author_comments on public.request_comments;
create trigger trg_fill_author_comments before insert on public.request_comments for each row execute function public.fill_author();

-- ===== read policies (no client INSERT/UPDATE on orders, order_items, order_contacts, order_declines, stores) =====
-- remove every policy left by older versions so only the ones below exist
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "regions read" on public.regions;
create policy "regions read" on public.regions for select to anon, authenticated using (is_active = true or public.is_admin());
drop policy if exists "regions admin all" on public.regions;
create policy "regions admin all" on public.regions for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "stores read" on public.stores;
create policy "stores read" on public.stores for select to anon, authenticated using (status = 'active' or owner_id = auth.uid() or public.is_admin());
drop policy if exists "stores update own" on public.stores;
create policy "stores update own" on public.stores for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "products read" on public.products;
create policy "products read" on public.products for select to anon, authenticated using (
  (is_available = true and exists(select 1 from public.stores s where s.id = store_id and s.status = 'active'))
  or exists(select 1 from public.stores s where s.id = store_id and s.owner_id = auth.uid())
  or public.is_admin());
drop policy if exists "products owner insert" on public.products;
create policy "products owner insert" on public.products for insert to authenticated
  with check (exists(select 1 from public.stores s where s.id = store_id and s.owner_id = auth.uid()) and not public.is_blocked());
drop policy if exists "products owner update" on public.products;
create policy "products owner update" on public.products for update to authenticated
  using (exists(select 1 from public.stores s where s.id = store_id and s.owner_id = auth.uid()))
  with check (exists(select 1 from public.stores s where s.id = store_id and s.owner_id = auth.uid()));
drop policy if exists "products owner delete" on public.products;
create policy "products owner delete" on public.products for delete to authenticated
  using (exists(select 1 from public.stores s where s.id = store_id and s.owner_id = auth.uid()));
drop policy if exists "products admin all" on public.products;
create policy "products admin all" on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "orders customer read" on public.orders;
create policy "orders customer read" on public.orders for select to authenticated using (customer_id = auth.uid());
drop policy if exists "orders store read" on public.orders;
create policy "orders store read" on public.orders for select to authenticated using (exists(select 1 from public.stores s where s.id = store_id and s.owner_id = auth.uid()));
drop policy if exists "orders courier read" on public.orders;
create policy "orders courier read" on public.orders for select to authenticated using (
  courier_id = auth.uid()
  or (public.has_role('courier') and delivery_required and courier_id is null and status in ('accepted','preparing','ready')
      and not exists(select 1 from public.orders active where active.courier_id = auth.uid() and active.status not in ('delivered','cancelled'))
      and not exists(select 1 from public.order_declines d where d.order_id = id and d.courier_id = auth.uid())));
drop policy if exists "orders admin read" on public.orders;
create policy "orders admin read" on public.orders for select to authenticated using (public.is_admin());
drop policy if exists "order items follow order" on public.order_items;
create policy "order items follow order" on public.order_items for select to authenticated using (exists(select 1 from public.orders o where o.id = order_id));
drop policy if exists "order contacts read" on public.order_contacts;
create policy "order contacts read" on public.order_contacts for select to authenticated using (
  public.is_admin() or exists(
    select 1 from public.orders o left join public.stores s on s.id = o.store_id
    where o.id = order_id and (o.customer_id = auth.uid() or s.owner_id = auth.uid()
      or (o.courier_id = auth.uid() and o.fee_status = 'accepted'))));
drop policy if exists "order declines own" on public.order_declines;
create policy "order declines own" on public.order_declines for select to authenticated using (courier_id = auth.uid());

drop policy if exists "requests read" on public.request_posts;
create policy "requests read" on public.request_posts for select to authenticated using (true);
drop policy if exists "requests insert customer" on public.request_posts;
create policy "requests insert customer" on public.request_posts for insert to authenticated with check (public.has_role('customer'));
drop policy if exists "requests update own" on public.request_posts;
create policy "requests update own" on public.request_posts for update to authenticated using (customer_id = auth.uid()) with check (customer_id = auth.uid());
drop policy if exists "requests admin delete" on public.request_posts;
create policy "requests admin delete" on public.request_posts for delete to authenticated using (public.is_admin());
drop policy if exists "comments read" on public.request_comments;
create policy "comments read" on public.request_comments for select to authenticated using (true);
drop policy if exists "comments insert" on public.request_comments;
create policy "comments insert" on public.request_comments for insert to authenticated with check (not public.is_blocked());
drop policy if exists "comments admin delete" on public.request_comments;
create policy "comments admin delete" on public.request_comments for delete to authenticated using (public.is_admin());

drop policy if exists "announcements read" on public.announcements;
create policy "announcements read" on public.announcements for select to anon, authenticated using (status = 'published' or public.is_admin());
drop policy if exists "announcements admin all" on public.announcements;
create policy "announcements admin all" on public.announcements for all to authenticated using (public.is_admin()) with check (public.is_admin() and admin_id = auth.uid());
drop policy if exists "settings read" on public.platform_settings;
create policy "settings read" on public.platform_settings for select to authenticated using (true);
drop policy if exists "settings admin write" on public.platform_settings;
create policy "settings admin write" on public.platform_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "audit admin read" on public.admin_audit_log;
create policy "audit admin read" on public.admin_audit_log for select to authenticated using (public.is_admin());
drop policy if exists "notifications own read" on public.notifications;
create policy "notifications own read" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "notifications own update" on public.notifications;
create policy "notifications own update" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== storage: one public bucket, 1 MB per file, images only, each user writes only inside a folder named after their id =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists "images public read" on storage.objects;
create policy "images public read" on storage.objects for select using (bucket_id = 'images');
drop policy if exists "images own insert" on storage.objects;
create policy "images own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text and not public.is_blocked());
drop policy if exists "images own delete" on storage.objects;
create policy "images own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== write functions =====
drop function if exists public.register_store(text,text,text,text,uuid,text);
create or replace function public.register_store(p_name text, p_category text, p_description text, p_address text, p_region_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me public.profiles; v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found or v_me.is_blocked or v_me.role not in ('customer','merchant') then raise exception 'not allowed'; end if;
  if exists(select 1 from public.stores where owner_id = auth.uid()) then raise exception 'store already registered'; end if;
  insert into public.stores(owner_id, name, category, description, address, region_id)
  values (auth.uid(), btrim(p_name), btrim(p_category), nullif(btrim(coalesce(p_description,'')),''), nullif(btrim(coalesce(p_address,'')),''), p_region_id)
  returning id into v_id;
  perform set_config('wesla.bypass', '1', true);
  update public.profiles set role = 'merchant' where id = auth.uid() and role = 'customer';
  return v_id;
end $$;

create or replace function public.create_order(p_store_id uuid, p_items jsonb, p_delivery boolean, p_address text, p_proposed_fee numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me public.profiles; v_order uuid; v_sub numeric(10,2) := 0; v_fee numeric(10,2) := 0; r record;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found or v_me.is_blocked or v_me.role <> 'customer' then raise exception 'not allowed'; end if;
  if not exists(select 1 from public.stores where id = p_store_id and status = 'active') then raise exception 'store unavailable'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'invalid items'; end if;
  if (select count(*) from public.orders where customer_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then raise exception 'too many orders'; end if;
  if p_delivery then
    if p_address is null or char_length(btrim(p_address)) not between 3 and 300 then raise exception 'address required'; end if;
    if p_proposed_fee is null or p_proposed_fee < 0 or p_proposed_fee > 500 then raise exception 'invalid fee'; end if;
    v_fee := round(p_proposed_fee, 2);
  end if;
  insert into public.orders(customer_id, store_id, address_snapshot, subtotal, proposed_delivery_fee, delivery_required, delivery_fee, total, fee_status)
  values (auth.uid(), p_store_id, case when p_delivery then btrim(p_address) else 'استلام من المحل' end, 0, v_fee, p_delivery, v_fee, 0,
          case when p_delivery then 'pending' else 'accepted' end)
  returning id into v_order;
  for r in select (e->>'product_id')::uuid as pid, (e->>'qty')::int as qty from jsonb_array_elements(p_items) e loop
    if r.qty is null or r.qty < 1 or r.qty > 50 then raise exception 'invalid quantity'; end if;
    insert into public.order_items(order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, line_total, image_path_snapshot)
    select v_order, p.id, p.name, p.price, r.qty, p.price * r.qty, p.image_path
    from public.products p where p.id = r.pid and p.store_id = p_store_id and p.is_available;
    if not found then raise exception 'product unavailable'; end if;
  end loop;
  select coalesce(sum(line_total), 0) into v_sub from public.order_items where order_id = v_order;
  update public.orders set subtotal = v_sub, total = v_sub + v_fee where id = v_order;
  insert into public.order_contacts(order_id, customer_name, customer_phone) values (v_order, v_me.full_name, coalesce(v_me.phone, ''));
  return v_order;
end $$;

create or replace function public.merchant_set_order_status(p_order_id uuid, p_status public.order_status)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; ok boolean;
begin
  if public.is_blocked() then raise exception 'not allowed'; end if;
  select o2.* into o from public.orders o2 join public.stores s on s.id = o2.store_id
   where o2.id = p_order_id and s.owner_id = auth.uid() for update of o2;
  if not found then raise exception 'order not found'; end if;
  ok := (p_status = 'cancelled' and o.status in ('new','accepted','preparing','ready'))
     or (o.status = 'new' and p_status = 'accepted')
     or (o.status = 'accepted' and p_status in ('preparing','ready'))
     or (o.status = 'preparing' and p_status = 'ready')
     or (o.status = 'ready' and p_status = 'delivered' and not o.delivery_required);
  if not ok then raise exception 'invalid transition'; end if;
  update public.orders set status = p_status where id = o.id;
end $$;

create or replace function public.customer_cancel_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'order not found'; end if;
  if o.status <> 'new' then raise exception 'invalid transition'; end if;
  update public.orders set status = 'cancelled' where id = o.id;
end $$;

create or replace function public.courier_offer_fee(p_order_id uuid, p_fee numeric, p_reply text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; v_fee numeric(10,2);
begin
  if not public.has_role('courier') or public.is_blocked() then raise exception 'not allowed'; end if;
  if exists(select 1 from public.orders where courier_id = auth.uid() and status not in ('delivered','cancelled')) then raise exception 'active delivery exists'; end if;
  if p_fee is null or p_fee < 0 or p_fee > 500 then raise exception 'invalid fee'; end if;
  v_fee := round(p_fee, 2);
  select * into o from public.orders where id = p_order_id for update;
  if not found or not o.delivery_required or o.courier_id is not null or o.fee_status <> 'pending'
     or o.status not in ('accepted','preparing','ready')
     or exists(select 1 from public.order_declines d where d.order_id = o.id and d.courier_id = auth.uid()) then
    raise exception 'order not available';
  end if;
  update public.orders set courier_id = auth.uid(), courier_proposed_fee = v_fee, courier_reply = left(coalesce(p_reply, ''), 300),
         fee_status = case when v_fee = o.proposed_delivery_fee then 'accepted' else 'countered' end,
         delivery_fee = v_fee, total = o.subtotal + v_fee where id = o.id;
end $$;

create or replace function public.courier_decline_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.has_role('courier') or public.is_blocked() then raise exception 'not allowed'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found or not o.delivery_required or o.status not in ('accepted','preparing','ready')
     or (o.courier_id is not null and o.courier_id <> auth.uid()) then
    raise exception 'order not available';
  end if;
  insert into public.order_declines(order_id, courier_id) values (o.id, auth.uid()) on conflict do nothing;
  if o.courier_id = auth.uid() then
    update public.orders set courier_id = null, courier_proposed_fee = null, courier_reply = null, fee_status = 'pending',
           delivery_fee = o.proposed_delivery_fee, total = o.subtotal + o.proposed_delivery_fee where id = o.id;
  end if;
end $$;

create or replace function public.customer_respond_fee(p_order_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if public.is_blocked() then raise exception 'not allowed'; end if;
  select * into o from public.orders where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'order not found'; end if;
  if o.fee_status <> 'countered' or o.courier_id is null or o.status in ('cancelled','delivered','with_courier') then raise exception 'invalid transition'; end if;
  if p_accept then
    update public.orders set fee_status = 'accepted' where id = o.id;
  else
    insert into public.order_declines(order_id, courier_id) values (o.id, o.courier_id) on conflict do nothing;
    update public.orders set courier_id = null, courier_proposed_fee = null, courier_reply = null, fee_status = 'pending',
           delivery_fee = o.proposed_delivery_fee, total = o.subtotal + o.proposed_delivery_fee where id = o.id;
  end if;
end $$;

create or replace function public.courier_pickup_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.has_role('courier') or public.is_blocked() then raise exception 'not allowed'; end if;
  select * into o from public.orders where id = p_order_id and courier_id = auth.uid() for update;
  if not found then raise exception 'order not found'; end if;
  if o.fee_status <> 'accepted' or o.status <> 'ready' then raise exception 'invalid transition'; end if;
  update public.orders set status = 'with_courier' where id = o.id;
end $$;

create or replace function public.courier_deliver_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.has_role('courier') or public.is_blocked() then raise exception 'not allowed'; end if;
  select * into o from public.orders where id = p_order_id and courier_id = auth.uid() for update;
  if not found then raise exception 'order not found'; end if;
  if o.status <> 'with_courier' then raise exception 'invalid transition'; end if;
  update public.orders set status = 'delivered', courier_lat = null, courier_lng = null where id = o.id;
end $$;

create or replace function public.courier_update_location(p_order_id uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role('courier') or public.is_blocked() then raise exception 'not allowed'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'invalid location'; end if;
  update public.orders set courier_lat = p_lat, courier_lng = p_lng
   where id = p_order_id and courier_id = auth.uid() and status = 'with_courier';
  if not found then raise exception 'order not available'; end if;
end $$;

create or replace function public.admin_set_store_status(p_store_id uuid, p_status public.store_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  perform set_config('wesla.bypass', '1', true);
  update public.stores set status = p_status where id = p_store_id;
  if not found then raise exception 'order not found'; end if;
  insert into public.admin_audit_log(admin_id, action, target_type, target_id, details)
  values (auth.uid(), 'store_status', 'store', p_store_id::text, jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() or p_user = auth.uid() then raise exception 'not allowed'; end if;
  perform set_config('wesla.bypass', '1', true);
  update public.profiles set role = p_role where id = p_user;
  insert into public.admin_audit_log(admin_id, action, target_type, target_id, details)
  values (auth.uid(), 'set_role', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

create or replace function public.admin_set_blocked(p_user uuid, p_blocked boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() or p_user = auth.uid() then raise exception 'not allowed'; end if;
  perform set_config('wesla.bypass', '1', true);
  update public.profiles set is_blocked = p_blocked where id = p_user;
  if p_blocked then update public.stores set status = 'paused' where owner_id = p_user and status = 'active'; end if;
  insert into public.admin_audit_log(admin_id, action, target_type, target_id, details)
  values (auth.uid(), 'set_blocked', 'user', p_user::text, jsonb_build_object('blocked', p_blocked));
end $$;

-- functions are callable by signed-in users only
do $$ declare f text; begin
  foreach f in array array[
    'register_store(text,text,text,text,uuid)',
    'create_order(uuid,jsonb,boolean,text,numeric)',
    'merchant_set_order_status(uuid,public.order_status)',
    'customer_cancel_order(uuid)',
    'courier_offer_fee(uuid,numeric,text)',
    'courier_decline_order(uuid)',
    'customer_respond_fee(uuid,boolean)',
    'courier_pickup_order(uuid)',
    'courier_deliver_order(uuid)',
    'courier_update_location(uuid,double precision,double precision)',
    'admin_set_store_status(uuid,public.store_status)',
    'admin_set_role(uuid,public.app_role)',
    'admin_set_blocked(uuid,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- FIRST ADMIN (run once in the SQL editor after you sign up in the app; replace the phone):
--   update public.profiles set role = 'admin' where phone = '201012345678';
