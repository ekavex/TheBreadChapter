-- Customisable print layouts (bill + KOT) and test prints from the editor.
-- See src/lib/printer/template/. With no row for a kind, the built-in default
-- layout is used, which matches the pre-customisation print exactly.

CREATE TABLE IF NOT EXISTS public.print_templates (
    cafe_id    uuid                     NOT NULL,
    kind       text                     NOT NULL,
    template   jsonb                    NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    CONSTRAINT print_templates_pkey PRIMARY KEY (cafe_id, kind),
    CONSTRAINT print_templates_kind_check CHECK (kind = ANY (ARRAY['bill'::text, 'kot'::text])),
    CONSTRAINT print_templates_cafe_id_fkey FOREIGN KEY (cafe_id) REFERENCES public.cafes(id) ON DELETE CASCADE
);

-- "Print test" from the editor: a pre-rendered sample ticket for one printer.
-- Separate from kot_tickets because it belongs to no order.
CREATE TABLE IF NOT EXISTS public.print_test_jobs (
    id           uuid                     DEFAULT public.uuid_generate_v4() NOT NULL,
    cafe_id      uuid                     NOT NULL,
    station      text                     NOT NULL,
    kind         text                     NOT NULL,
    payload      bytea                    NOT NULL,
    status       text                     DEFAULT 'queued'::text NOT NULL,
    requested_by text,
    created_at   timestamp with time zone DEFAULT now() NOT NULL,
    printed_at   timestamp with time zone,
    CONSTRAINT print_test_jobs_pkey PRIMARY KEY (id),
    CONSTRAINT print_test_jobs_station_check CHECK (station = ANY (ARRAY['kitchen'::text, 'beverage_counter'::text])),
    CONSTRAINT print_test_jobs_kind_check CHECK (kind = ANY (ARRAY['bill'::text, 'kot'::text])),
    CONSTRAINT print_test_jobs_status_check CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'printed'::text])),
    CONSTRAINT print_test_jobs_cafe_id_fkey FOREIGN KEY (cafe_id) REFERENCES public.cafes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_print_test_jobs_queued
    ON public.print_test_jobs USING btree (station, created_at)
    WHERE (status = 'queued'::text);
