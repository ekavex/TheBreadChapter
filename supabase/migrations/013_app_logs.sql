-- Central log store for developers: server events, print-bridge / app logs
-- uploaded by the Android phones, and errors from the POS/dashboard browsers.
-- Query app_logs_view (IST time + order number). Rows older than 14 days are
-- deleted automatically by the app (src/lib/observability/logStore.ts).

CREATE TABLE IF NOT EXISTS public.app_logs (
    id          bigint GENERATED ALWAYS AS IDENTITY,
    logged_at   timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    source      text NOT NULL,
    level       text NOT NULL,
    event       text NOT NULL,
    message     text,
    order_id    uuid,
    device_id   text,
    app_version text,
    request_id  text,
    data        jsonb,
    CONSTRAINT app_logs_pkey PRIMARY KEY (id),
    CONSTRAINT app_logs_source_check CHECK (source = ANY (ARRAY['server'::text, 'device'::text, 'browser'::text])),
    CONSTRAINT app_logs_level_check CHECK (level = ANY (ARRAY['debug'::text, 'info'::text, 'warn'::text, 'error'::text]))
);

CREATE INDEX IF NOT EXISTS idx_app_logs_logged_at ON public.app_logs USING btree (logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_received_at ON public.app_logs USING btree (received_at);
CREATE INDEX IF NOT EXISTS idx_app_logs_problems ON public.app_logs USING btree (logged_at DESC)
    WHERE (level = ANY (ARRAY['warn'::text, 'error'::text]));
CREATE INDEX IF NOT EXISTS idx_app_logs_order ON public.app_logs USING btree (order_id, logged_at)
    WHERE (order_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_app_logs_device ON public.app_logs USING btree (device_id, logged_at DESC)
    WHERE (device_id IS NOT NULL);

-- Developer-friendly view: cafe-local time and the order number.
CREATE OR REPLACE VIEW public.app_logs_view AS
SELECT
    (l.logged_at AT TIME ZONE 'Asia/Kolkata') AS ist_time,
    l.source,
    l.level,
    l.event,
    l.message,
    o.order_number,
    l.device_id,
    l.app_version,
    l.request_id,
    l.data,
    l.order_id,
    l.id
FROM public.app_logs l
LEFT JOIN public.orders o ON o.id = l.order_id;
