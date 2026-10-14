-- When the print bridge claimed a job (queued -> processing). The "stuck job"
-- reclaim in /api/pos/print-jobs used to time from printed_at, which is when
-- the job was *queued*: a bill that had waited 45s was treated as stuck the
-- moment it was claimed, so another poll could hand it out again mid-print.
-- The print-jobs route also adds this column itself before its first claim.
ALTER TABLE public.kot_tickets ADD COLUMN IF NOT EXISTS claimed_at timestamp with time zone;
