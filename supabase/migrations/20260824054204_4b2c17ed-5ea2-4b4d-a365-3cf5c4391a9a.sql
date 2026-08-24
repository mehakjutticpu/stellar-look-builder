-- Lock down secure_messages
DROP POLICY IF EXISTS "anyone can read secure message" ON public.secure_messages;
DROP POLICY IF EXISTS "anyone can mark viewed" ON public.secure_messages;

-- Lock down access_events: require valid message_id on insert
DROP POLICY IF EXISTS "anyone can log event" ON public.access_events;
CREATE POLICY "log event for existing message"
ON public.access_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  message_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.secure_messages m WHERE m.id = message_id)
);

-- Storage: explicit deny for read/delete on secure-files and selfies (service_role bypasses RLS)
DROP POLICY IF EXISTS "rdx_secure_files_no_read" ON storage.objects;
DROP POLICY IF EXISTS "rdx_secure_files_no_delete" ON storage.objects;
DROP POLICY IF EXISTS "rdx_selfies_no_read" ON storage.objects;
DROP POLICY IF EXISTS "rdx_selfies_no_delete" ON storage.objects;
DROP POLICY IF EXISTS "rdx_selfies_no_insert" ON storage.objects;

CREATE POLICY "rdx_secure_files_no_read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (false AND bucket_id = 'secure-files');

CREATE POLICY "rdx_secure_files_no_delete"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (false AND bucket_id = 'secure-files');

CREATE POLICY "rdx_selfies_no_read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (false AND bucket_id = 'selfies');

CREATE POLICY "rdx_selfies_no_delete"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (false AND bucket_id = 'selfies');

CREATE POLICY "rdx_selfies_no_insert"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (false AND bucket_id = 'selfies');