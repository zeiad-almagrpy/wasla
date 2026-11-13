-- WESLA migration 005. Requires 002. Safe to re-run.
-- Every photo is now stored twice (full + thumbnail), so the per-user file cap goes from 200 to 600 (= about 300 photos).
do $$ begin
  drop policy if exists "images own insert" on storage.objects;
  create policy "images own insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text and not public.is_blocked()
      and (select count(*) from storage.objects x where x.bucket_id = 'images' and (storage.foldername(x.name))[1] = auth.uid()::text) < 600);
exception when others then
  raise notice 'storage policy NOT changed (%). Edit "images own insert" from Storage > Policies and use < 600 instead of < 200.', sqlerrm;
end $$;
