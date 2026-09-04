-- Print reliability + audit log (fixes duplicate KOT/bill prints from a
-- double-click or a retried request, and gives the admin dashboard a
-- Printing page to see every print event: queued, printed, skipped as a
-- duplicate, or reclaimed as stale).

-- At most one *active* (queued/processing) print job per order+station+type.
-- A second near-simultaneous request for the same ticket (double-tap, retry)
-- hits this constraint instead of queuing a second physical print. Once a
-- job resolves (printed) the slot frees up for a genuine later reprint.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_kot_ticket
    ON public.kot_tickets USING btree (order_id, station, job_type)
    WHERE (print_status = ANY (ARRAY['queued'::text, 'processing'::text]));

CREATE TABLE IF NOT EXISTS public.print_log (
    id            uuid        DEFAULT public.uuid_generate_v4() NOT NULL,
    kot_ticket_id uuid,
    order_id      uuid        NOT NULL,
    station       text        NOT NULL,
    job_type      text        NOT NULL,
    event         text        NOT NULL,
    detail        text,
    actor         text,
    created_at    timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT print_log_pkey PRIMARY KEY (id),
    CONSTRAINT print_log_event_check
        CHECK (event = ANY (ARRAY['queued'::text, 'printed'::text, 'stale_reclaimed'::text, 'skipped_duplicate'::text])),
    CONSTRAINT print_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_print_log_order_created ON public.print_log USING btree (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_log_created ON public.print_log USING btree (created_at DESC);
