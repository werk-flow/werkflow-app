-- SI-027: the public avatar bucket existed only in production (created in the
-- dashboard). DEV and the local stack lacked it, so avatar upload could not be
-- verified outside production. This mirrors the production bucket and its two
-- object policies; on production every statement is a no-op.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif']
)
on conflict (id) do nothing;

drop policy if exists "Users can upload own profile avatars" on storage.objects;
create policy "Users can upload own profile avatars"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can delete own profile avatars" on storage.objects;
create policy "Users can delete own profile avatars"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and owner_id = (select auth.uid())::text
);
