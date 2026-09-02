-- Outbound webhook outbox for the standalone TBC Inventory system.
--
-- When a KOT is sent or an order is cancelled, the POS enqueues a row here in
-- the SAME transaction as the state change, then a background flusher delivers
-- it to the inventory service (POST /api/webhooks/pos-kot | pos-cancel). This
-- keeps stock deduction fully decoupled from KOT printing: if the inventory
-- service is slow or down, the ticket still prints and the row is retried.
--
-- Inert until INVENTORY_WEBHOOK_URL is configured - enqueue is skipped and the
-- table simply stays empty.
CREATE TABLE IF NOT EXISTS public.inventory_webhook_outbox (
    id              uuid        DEFAULT gen_random_uuid() NOT NULL,
    event_type      text        NOT NULL,
    payload         jsonb       NOT NULL,
    status          text        DEFAULT 'pending' NOT NULL,
    attempts        integer     DEFAULT 0 NOT NULL,
    last_error      text,
    last_attempt_at timestamp with time zone,
    delivered_at    timestamp with time zone,
    created_at      timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_webhook_outbox_pkey PRIMARY KEY (id),
    CONSTRAINT inventory_webhook_outbox_event_type_check
        CHECK (event_type = ANY (ARRAY['pos-kot'::text, 'pos-cancel'::text])),
    CONSTRAINT inventory_webhook_outbox_status_check
        CHECK (status = ANY (ARRAY['pending'::text, 'delivered'::text, 'failed'::text]))
);

CREATE INDEX IF NOT EXISTS idx_inventory_webhook_outbox_pending
    ON public.inventory_webhook_outbox USING btree (created_at)
    WHERE (status = 'pending'::text);
