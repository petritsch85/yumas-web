-- Add delivery note image URL to purchase orders
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS lieferschein_url text;

-- Storage bucket for delivery note images
-- NOTE: Also create the bucket manually in Supabase Dashboard:
-- Storage → New bucket → Name: "lieferscheine" → Public: ON
-- Then add these policies:

-- Allow authenticated users to upload
INSERT INTO storage.buckets (id, name, public) VALUES ('lieferscheine', 'lieferscheine', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload lieferscheine"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lieferscheine');

CREATE POLICY "Public can view lieferscheine"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'lieferscheine');

CREATE POLICY "Authenticated users can update lieferscheine"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'lieferscheine');
