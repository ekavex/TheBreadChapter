--
-- PostgreSQL database dump
--


-- Dumped from database version 18.4 (Debian 18.4-1+b1)
-- Dumped by pg_dump version 18.4 (Debian 18.4-1+b1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- SET transaction_timeout = 0; -- pg18 only, removed for pg16 compat
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: menu_item_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.menu_item_category AS ENUM (
    'food',
    'beverage'
);


--
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_status AS ENUM (
    'pending',
    'confirmed',
    'making',
    'ready',
    'served',
    'cancelled',
    'completed'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'upi',
    'card',
    'cash',
    'unpaid'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'paid',
    'failed',
    'refunded'
);


--
-- Name: stock_txn_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.stock_txn_type AS ENUM (
    'purchase',
    'sale_deduction',
    'manual_adjustment',
    'expired_removal'
);


--
-- Name: table_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.table_status AS ENUM (
    'free',
    'occupied',
    'kot_sent',
    'billed'
);


--
-- Name: apply_stock_transaction(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_stock_transaction() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE ingredients
  SET current_stock = current_stock + NEW.quantity
  WHERE id = NEW.ingredient_id;
  RETURN NEW;
END;
$$;


--
-- Name: generate_order_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_order_number(cafe_id uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  seq_val INT;
BEGIN
  seq_val := nextval('order_number_seq');
  RETURN 'ORD-' || LPAD(seq_val::TEXT, 4, '0');
END;
$$;


--
-- Name: increment_order_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_order_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE menu_items
  SET order_count = order_count + NEW.quantity
  WHERE id = NEW.menu_item_id;
  RETURN NEW;
END;
$$;


--
-- Name: on_ingredient_cost_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_ingredient_cost_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.cost_per_unit_paisa IS DISTINCT FROM OLD.cost_per_unit_paisa THEN
    PERFORM recompute_menu_items_for_ingredient(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: on_recipe_ingredients_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_recipe_ingredients_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_recipe_id UUID := COALESCE(NEW.recipe_id, OLD.recipe_id);
  v_menu_item_id UUID;
BEGIN
  SELECT menu_item_id INTO v_menu_item_id FROM recipes WHERE id = v_recipe_id;
  IF v_menu_item_id IS NOT NULL THEN
    PERFORM recompute_menu_item_cost(v_menu_item_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: recompute_menu_item_cost(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_menu_item_cost(p_menu_item_id uuid) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_cost BIGINT;
BEGIN
  SELECT COALESCE(SUM(ri.quantity * i.cost_per_unit_paisa), 0)::BIGINT
  INTO v_cost
  FROM recipes r
  JOIN recipe_ingredients ri ON ri.recipe_id = r.id
  JOIN ingredients i ON i.id = ri.ingredient_id
  WHERE r.menu_item_id = p_menu_item_id;

  UPDATE menu_items SET cost_price_paisa = v_cost WHERE id = p_menu_item_id;
  RETURN v_cost;
END;
$$;


--
-- Name: recompute_menu_items_for_ingredient(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_menu_items_for_ingredient(p_ingredient_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_menu_item_id UUID;
BEGIN
  FOR v_menu_item_id IN
    SELECT DISTINCT r.menu_item_id
    FROM recipe_ingredients ri
    JOIN recipes r ON r.id = ri.recipe_id
    WHERE ri.ingredient_id = p_ingredient_id
  LOOP
    PERFORM recompute_menu_item_cost(v_menu_item_id);
  END LOOP;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auth_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_credentials (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id text NOT NULL,
    password_hash text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    role text DEFAULT 'manager'::text NOT NULL,
    display_name text DEFAULT ''::text NOT NULL,
    CONSTRAINT auth_credentials_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'manager'::text, 'staff'::text])))
);


--
-- Name: cafes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cafes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    logo_url text,
    address text,
    phone text,
    whatsapp text,
    currency text DEFAULT 'INR'::text NOT NULL,
    timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    settings jsonb DEFAULT '{"languages": ["en", "hi"], "accept_upi": true, "accept_card": false, "accept_cash": true, "tax_percent": 5, "show_social_proof": true, "service_charge_percent": 0}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    cafe_id uuid NOT NULL,
    phone text NOT NULL,
    name text,
    whatsapp text,
    total_orders integer DEFAULT 0 NOT NULL,
    total_spent numeric(12,2) DEFAULT 0 NOT NULL,
    last_visit_at timestamp with time zone,
    tags text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ingredients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingredients (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    current_stock numeric(12,3) DEFAULT 0 NOT NULL,
    low_stock_threshold numeric(12,3) DEFAULT 0 NOT NULL,
    cost_per_unit_paisa bigint DEFAULT 0 NOT NULL,
    is_perishable boolean DEFAULT false NOT NULL,
    expiry_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: kot_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kot_tickets (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    station text NOT NULL,
    items_json jsonb NOT NULL,
    printed_at timestamp with time zone DEFAULT now() NOT NULL,
    print_status text DEFAULT 'mock_printed'::text NOT NULL,
    job_type text DEFAULT 'kot'::text NOT NULL,
    taken_by text,
    CONSTRAINT kot_tickets_station_check CHECK ((station = ANY (ARRAY['kitchen'::text, 'beverage_counter'::text]))),
    CONSTRAINT kot_tickets_job_type_check CHECK ((job_type = ANY (ARRAY['kot'::text, 'bill_qr'::text])))
);


--
-- Name: menu_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_categories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    cafe_id uuid NOT NULL,
    name text NOT NULL,
    name_hi text,
    description text,
    image_url text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    cafe_id uuid NOT NULL,
    category_id uuid NOT NULL,
    name text NOT NULL,
    name_hi text,
    description text,
    description_hi text,
    price numeric(10,2) NOT NULL,
    image_url text,
    is_veg boolean DEFAULT true NOT NULL,
    is_vegan boolean DEFAULT false NOT NULL,
    is_jain boolean DEFAULT false NOT NULL,
    contains_gluten boolean DEFAULT true NOT NULL,
    contains_nuts boolean DEFAULT false NOT NULL,
    spice_level integer DEFAULT 0,
    is_available boolean DEFAULT true NOT NULL,
    is_featured boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    order_count integer DEFAULT 0 NOT NULL,
    prep_time_mins integer DEFAULT 10 NOT NULL,
    upsell_item_ids uuid[] DEFAULT '{}'::uuid[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    category public.menu_item_category DEFAULT 'food'::public.menu_item_category NOT NULL,
    cost_price_paisa bigint DEFAULT 0 NOT NULL,
    CONSTRAINT menu_items_spice_level_check CHECK (((spice_level >= 0) AND (spice_level <= 3)))
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    menu_item_id uuid NOT NULL,
    name text NOT NULL,
    price numeric(10,2) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    customisation text,
    subtotal numeric(10,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category public.menu_item_category
);


--
-- Name: order_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    cafe_id uuid NOT NULL,
    table_id uuid NOT NULL,
    customer_id uuid,
    order_number text NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    payment_method public.payment_method DEFAULT 'unpaid'::public.payment_method NOT NULL,
    payment_status public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
    razorpay_order_id text,
    razorpay_payment_id text,
    subtotal numeric(10,2) DEFAULT 0 NOT NULL,
    tax_amount numeric(10,2) DEFAULT 0 NOT NULL,
    service_charge numeric(10,2) DEFAULT 0 NOT NULL,
    discount_amount numeric(10,2) DEFAULT 0 NOT NULL,
    total_amount numeric(10,2) DEFAULT 0 NOT NULL,
    notes text,
    estimated_mins integer,
    confirmed_at timestamp with time zone,
    ready_at timestamp with time zone,
    served_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pos_status text DEFAULT 'OPEN'::text NOT NULL,
    total_paisa bigint DEFAULT 0 NOT NULL,
    kot_sent_at timestamp with time zone,
    billed_at timestamp with time zone,
    stock_deducted_at timestamp with time zone,
    last_reconciled_at timestamp with time zone,
    CONSTRAINT orders_pos_status_check CHECK ((pos_status = ANY (ARRAY['OPEN'::text, 'KOT_SENT'::text, 'BILLED'::text, 'AWAITING_PAYMENT'::text, 'PAID'::text, 'PAYMENT_FAILED'::text, 'REQUIRES_VERIFICATION'::text, 'CANCELLED'::text])))
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    transaction_number text NOT NULL,
    plutus_ptrid text,
    status text DEFAULT 'initiated'::text NOT NULL,
    mode text,
    amount_paisa bigint NOT NULL,
    rrn text,
    approval_code text,
    txn_log_id text,
    client_id text,
    store_id text,
    raw_response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['initiated'::text, 'approved'::text, 'declined'::text, 'cancelled'::text])))
);


--
-- Name: recipe_ingredients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipe_ingredients (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    recipe_id uuid NOT NULL,
    ingredient_id uuid NOT NULL,
    quantity numeric(12,3) NOT NULL
);


--
-- Name: recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    menu_item_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sections (
    id integer NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: staff_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cafe_id uuid NOT NULL,
    action text NOT NULL,
    description text NOT NULL,
    created_by text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stock_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ingredient_id uuid NOT NULL,
    type public.stock_txn_type NOT NULL,
    quantity numeric(12,3) NOT NULL,
    reference_order_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tables (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    cafe_id uuid NOT NULL,
    number integer NOT NULL,
    label text,
    capacity integer DEFAULT 4 NOT NULL,
    qr_code_url text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    section_id integer,
    status public.table_status DEFAULT 'free'::public.table_status NOT NULL,
    shape text DEFAULT 'square'::text NOT NULL,
    CONSTRAINT tables_shape_check CHECK ((shape = ANY (ARRAY['round'::text, 'square'::text, 'rectangle'::text])))
);


--
-- Name: terminals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terminals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    client_id text NOT NULL,
    label text NOT NULL,
    section_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_credentials auth_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_credentials
    ADD CONSTRAINT auth_credentials_pkey PRIMARY KEY (id);


--
-- Name: auth_credentials auth_credentials_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_credentials
    ADD CONSTRAINT auth_credentials_user_id_key UNIQUE (user_id);


--
-- Name: cafes cafes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cafes
    ADD CONSTRAINT cafes_pkey PRIMARY KEY (id);


--
-- Name: cafes cafes_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cafes
    ADD CONSTRAINT cafes_slug_key UNIQUE (slug);


--
-- Name: customers customers_cafe_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_cafe_id_phone_key UNIQUE (cafe_id, phone);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: ingredients ingredients_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_name_key UNIQUE (name);


--
-- Name: ingredients ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_pkey PRIMARY KEY (id);


--
-- Name: kot_tickets kot_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kot_tickets
    ADD CONSTRAINT kot_tickets_pkey PRIMARY KEY (id);


--
-- Name: menu_categories menu_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_categories
    ADD CONSTRAINT menu_categories_pkey PRIMARY KEY (id);


--
-- Name: menu_items menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_transaction_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_transaction_number_key UNIQUE (transaction_number);


--
-- Name: recipe_ingredients recipe_ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_pkey PRIMARY KEY (id);


--
-- Name: recipe_ingredients recipe_ingredients_recipe_id_ingredient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_recipe_id_ingredient_id_key UNIQUE (recipe_id, ingredient_id);


--
-- Name: recipes recipes_menu_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_menu_item_id_key UNIQUE (menu_item_id);


--
-- Name: recipes recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_pkey PRIMARY KEY (id);


--
-- Name: sections sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT sections_pkey PRIMARY KEY (id);


--
-- Name: staff_notifications staff_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_notifications
    ADD CONSTRAINT staff_notifications_pkey PRIMARY KEY (id);


--
-- Name: stock_transactions stock_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transactions
    ADD CONSTRAINT stock_transactions_pkey PRIMARY KEY (id);


--
-- Name: tables tables_cafe_id_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tables
    ADD CONSTRAINT tables_cafe_id_number_key UNIQUE (cafe_id, number);


--
-- Name: tables tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tables
    ADD CONSTRAINT tables_pkey PRIMARY KEY (id);


--
-- Name: terminals terminals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminals
    ADD CONSTRAINT terminals_pkey PRIMARY KEY (id);


--
-- Name: idx_kot_tickets_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kot_tickets_order ON public.kot_tickets USING btree (order_id);


--
-- Name: idx_menu_items_cafe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_cafe ON public.menu_items USING btree (cafe_id, category_id);


--
-- Name: idx_menu_items_featured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_featured ON public.menu_items USING btree (cafe_id, is_featured);


--
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- Name: idx_orders_cafe_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_cafe_id ON public.orders USING btree (cafe_id);


--
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: idx_orders_table_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_table_id ON public.orders USING btree (table_id);


--
-- Name: idx_payments_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_order ON public.payments USING btree (order_id);


--
-- Name: idx_payments_ptrid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_ptrid ON public.payments USING btree (plutus_ptrid);


--
-- Name: idx_payments_txn_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_txn_number ON public.payments USING btree (transaction_number);


--
-- Name: idx_staff_notifications_cafe_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_notifications_cafe_created ON public.staff_notifications USING btree (cafe_id, created_at DESC);


--
-- Name: idx_stock_transactions_ingredient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_transactions_ingredient ON public.stock_transactions USING btree (ingredient_id, created_at DESC);


--
-- Name: ingredients ingredients_cost_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ingredients_cost_change AFTER UPDATE ON public.ingredients FOR EACH ROW EXECUTE FUNCTION public.on_ingredient_cost_change();


--
-- Name: ingredients ingredients_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ingredients_updated_at BEFORE UPDATE ON public.ingredients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: menu_items menu_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER menu_items_updated_at BEFORE UPDATE ON public.menu_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: order_items order_item_increment_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_item_increment_count AFTER INSERT ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.increment_order_count();


--
-- Name: orders orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: recipe_ingredients recipe_ingredients_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER recipe_ingredients_change AFTER INSERT OR DELETE OR UPDATE ON public.recipe_ingredients FOR EACH ROW EXECUTE FUNCTION public.on_recipe_ingredients_change();


--
-- Name: stock_transactions stock_transactions_apply; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER stock_transactions_apply AFTER INSERT ON public.stock_transactions FOR EACH ROW EXECUTE FUNCTION public.apply_stock_transaction();


--
-- Name: customers customers_cafe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_cafe_id_fkey FOREIGN KEY (cafe_id) REFERENCES public.cafes(id) ON DELETE CASCADE;


--
-- Name: kot_tickets kot_tickets_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kot_tickets
    ADD CONSTRAINT kot_tickets_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: menu_categories menu_categories_cafe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_categories
    ADD CONSTRAINT menu_categories_cafe_id_fkey FOREIGN KEY (cafe_id) REFERENCES public.cafes(id) ON DELETE CASCADE;


--
-- Name: menu_items menu_items_cafe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_cafe_id_fkey FOREIGN KEY (cafe_id) REFERENCES public.cafes(id) ON DELETE CASCADE;


--
-- Name: menu_items menu_items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.menu_categories(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_menu_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: orders orders_cafe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_cafe_id_fkey FOREIGN KEY (cafe_id) REFERENCES public.cafes(id) ON DELETE CASCADE;


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: orders orders_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.tables(id);


--
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: recipe_ingredients recipe_ingredients_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id);


--
-- Name: recipe_ingredients recipe_ingredients_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_ingredients
    ADD CONSTRAINT recipe_ingredients_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;


--
-- Name: recipes recipes_menu_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id) ON DELETE CASCADE;


--
-- Name: staff_notifications staff_notifications_cafe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_notifications
    ADD CONSTRAINT staff_notifications_cafe_id_fkey FOREIGN KEY (cafe_id) REFERENCES public.cafes(id) ON DELETE CASCADE;


--
-- Name: stock_transactions stock_transactions_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transactions
    ADD CONSTRAINT stock_transactions_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE CASCADE;


--
-- Name: stock_transactions stock_transactions_reference_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_transactions
    ADD CONSTRAINT stock_transactions_reference_order_id_fkey FOREIGN KEY (reference_order_id) REFERENCES public.orders(id);


--
-- Name: tables tables_cafe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tables
    ADD CONSTRAINT tables_cafe_id_fkey FOREIGN KEY (cafe_id) REFERENCES public.cafes(id) ON DELETE CASCADE;


--
-- Name: tables tables_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tables
    ADD CONSTRAINT tables_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id);


--
-- Name: terminals terminals_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminals
    ADD CONSTRAINT terminals_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id);


--
-- Phase 1 payment reliability: audit trail, de-duplication and the
-- constraints that make double-charge bookkeeping impossible.
--

CREATE TABLE IF NOT EXISTS public.payment_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    payment_id uuid,
    order_id uuid,
    source text NOT NULL,
    ptrid text,
    dedupe_key text,
    reported text,
    verified text,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_events_pkey PRIMARY KEY (id),
    CONSTRAINT payment_events_source_check CHECK ((source = ANY (ARRAY['webhook'::text, 'poll'::text, 'reconciler'::text, 'cancel'::text]))),
    CONSTRAINT payment_events_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL,
    CONSTRAINT payment_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_event_dedupe ON public.payment_events USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_payment_events_order_created ON public.payment_events USING btree (order_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_order_per_table ON public.orders USING btree (table_id) WHERE (pos_status <> ALL (ARRAY['PAID'::text, 'CANCELLED'::text]));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_approved_payment_per_order ON public.payments USING btree (order_id) WHERE (status = 'approved'::text);

CREATE INDEX IF NOT EXISTS idx_orders_unsettled ON public.orders USING btree (pos_status, updated_at) WHERE (pos_status = ANY (ARRAY['AWAITING_PAYMENT'::text, 'REQUIRES_VERIFICATION'::text]));


--
-- Name: order_items Public can create order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can create order items" ON public.order_items FOR INSERT WITH CHECK (true);


--
-- Name: orders Public can create orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can create orders" ON public.orders FOR INSERT WITH CHECK (true);


--
-- Name: menu_items Public can read active menu items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read active menu items" ON public.menu_items FOR SELECT USING ((is_available = true));


--
-- Name: cafes Public can read cafe info; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read cafe info" ON public.cafes FOR SELECT USING ((is_active = true));


--
-- Name: menu_categories Public can read menu categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read menu categories" ON public.menu_categories FOR SELECT USING ((is_active = true));


--
-- Name: tables Public can read tables; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read tables" ON public.tables FOR SELECT USING ((is_active = true));


--
-- Name: order_items Public can view order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view order items" ON public.order_items FOR SELECT USING (true);


--
-- Name: orders Public can view their own order; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can view their own order" ON public.orders FOR SELECT USING (true);


--
-- Name: cafes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cafes ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: menu_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: menu_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: tables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;


--
-- PostgreSQL database dump complete
--


