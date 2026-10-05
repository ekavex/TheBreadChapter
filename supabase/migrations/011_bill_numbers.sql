-- Bill (invoice) numbers: a running series per Indian financial year,
-- e.g. TBC/26-27/0001, separate from orders.order_number (ORD-0042).
-- Assigned once when an order is first billed (src/lib/billNumber.ts).
-- Orders billed before this migration keep a NULL bill_number.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bill_number text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_bill_number
    ON public.orders USING btree (cafe_id, bill_number)
    WHERE (bill_number IS NOT NULL);

-- One row per cafe per financial year ("26-27"); last_value is the last
-- sequence number handed out. Incremented inside the billing transaction.
CREATE TABLE IF NOT EXISTS public.bill_number_counters (
    cafe_id        uuid    NOT NULL,
    financial_year text    NOT NULL,
    last_value     integer DEFAULT 0 NOT NULL,
    CONSTRAINT bill_number_counters_pkey PRIMARY KEY (cafe_id, financial_year),
    CONSTRAINT bill_number_counters_cafe_id_fkey FOREIGN KEY (cafe_id) REFERENCES public.cafes(id) ON DELETE CASCADE
);
