-- Email thread for purchase orders
CREATE TABLE IF NOT EXISTS po_messages (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  po_id        uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  direction    text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  from_email   text,
  to_email     text,
  subject      text,
  body         text,
  message_id   text,
  in_reply_to  text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS po_messages_po_id_idx ON po_messages(po_id, created_at);

-- Allow authenticated users to read/write their PO messages
ALTER TABLE po_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can read po_messages"
  ON po_messages FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth users can insert po_messages"
  ON po_messages FOR INSERT TO authenticated WITH CHECK (true);
