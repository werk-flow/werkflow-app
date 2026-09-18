-- Retire the Supabase Storage bucket that held document bytes before P1-00a moved
-- them to R2 (2026-08-04). No backend holds an object in it any more: DEV and the
-- local stack never did, PROD was emptied in pre-Wave-3 step 5 on 2026-09-18 after
-- the Willert objects were verified in werkflow-documents-prod and the test
-- organization's documents were deleted. The five object policies go here; the
-- bucket row itself is removed through the Storage API on each backend, because
-- Supabase refuses direct deletes from storage tables. documents.storage_bucket
-- keeps its logical label. profile-avatars stays.
drop policy if exists "Managers can select organization document objects" on storage.objects;
drop policy if exists "Managers can insert organization document objects" on storage.objects;
drop policy if exists "Managers can update organization document objects" on storage.objects;
drop policy if exists "Managers can delete organization document objects" on storage.objects;
drop policy if exists "Assigned employees can read linked document objects" on storage.objects;
