-- Tables
CREATE TABLE public.secure_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text_message text,
  file_name text,
  mime_type text,
  file_size bigint,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  viewed_at timestamptz,
  viewer_ip text,
  viewer_user_agent text,
  creator_ip text
);

CREATE TABLE public.access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES public.secure_messages(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  selfie_path text,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_events_message_id_idx ON public.access_events(message_id);
CREATE INDEX access_events_created_at_idx ON public.access_events(created_at DESC);
CREATE INDEX secure_messages_created_at_idx ON public.secure_messages(created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.secure_messages TO anon, authenticated;
GRANT ALL ON public.secure_messages TO service_role;
GRANT INSERT ON public.access_events TO anon, authenticated;
GRANT ALL ON public.access_events TO service_role;

ALTER TABLE public.secure_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can create secure message"
  ON public.secure_messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "anyone can read secure message"
  ON public.secure_messages FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "anyone can mark viewed"
  ON public.secure_messages FOR UPDATE
  TO anon, authenticated
  USING (viewed_at IS NULL)
  WITH CHECK (true);

CREATE POLICY "anyone can log event"
  ON public.access_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Storage object policies (buckets already exist)
CREATE POLICY "anyone upload secure-files"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'secure-files');

CREATE POLICY "anyone upload selfies"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'selfies');
