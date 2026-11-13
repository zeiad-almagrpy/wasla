-- WESLA migration 004. Requires 002 + 003. Safe to re-run.
-- Phone-number sign-up/sign-in (no email step):
--   * new accounts can come from Supabase phone auth (phone is read from auth.users.phone when the metadata lacks it)
--   * forgotten password = the admin issues a one-time temporary password after verifying the person on WhatsApp
--     (there is no email to send a reset link to). The user must choose a new password at next sign-in.

alter table public.profiles add column if not exists must_change_password boolean not null default false;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_phone text := coalesce(nullif(new.raw_user_meta_data->>'phone',''), regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'));
  v_req text := new.raw_user_meta_data->>'requested_role';
begin
  if v_phone is null or v_phone !~ '^[0-9]{10,15}$' then v_phone := null; end if;
  if v_req is null or v_req not in ('customer','merchant','courier') then v_req := 'customer'; end if;
  insert into public.profiles(id, full_name, phone, requested_role)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name',''), 80), v_phone, v_req)
  on conflict (id) do nothing;
  return new;
end $$;

-- Returns the temporary password ONCE. Writes the bcrypt hash straight into auth.users (the supported alternative is an Edge Function
-- calling auth.admin.updateUserById; this needs no deployment). Existing sessions of that user are removed.
create or replace function public.admin_reset_password(p_user uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pw text := ''; b bytea; i integer;
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';   -- no look-alike characters (no 0/o, 1/l/i)
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user not found'; end if;
  b := extensions.gen_random_bytes(8);
  for i in 0..7 loop v_pw := v_pw || substr(alphabet, (get_byte(b, i) % 31) + 1, 1); end loop;
  update auth.users set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')) where id = p_user;
  begin delete from auth.sessions where user_id = p_user;
  exception when undefined_table or undefined_column then null; end;
  perform set_config('wesla.bypass', '1', true);
  update public.profiles set must_change_password = true where id = p_user;
  insert into public.admin_audit_log(admin_id, action, target_type, target_id) values (auth.uid(), 'user_reset_password', 'user', p_user::text);
  return v_pw;
end $$;
revoke all on function public.admin_reset_password(uuid) from public, anon;
grant execute on function public.admin_reset_password(uuid) to authenticated;
