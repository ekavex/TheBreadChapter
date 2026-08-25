-- Add job_type to kot_tickets so the print bridge can distinguish
-- a Kitchen/Beverage KOT from a UPI QR bill receipt.
ALTER TABLE public.kot_tickets
  ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'kot'
    CONSTRAINT kot_tickets_job_type_check CHECK (job_type IN ('kot', 'bill_qr'));
