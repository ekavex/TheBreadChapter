-- Seed data: cafe, users, menu, tables, sections
-- Applied automatically by Docker on first start (empty volume only).
-- Passwords: admin=admin123, manager=manager123, staff=staff123

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET row_security = off;

-- ── Cafe ────────────────────────────────────────────────────────────────────

ALTER TABLE public.cafes DISABLE TRIGGER ALL;
COPY public.cafes (id, name, slug, logo_url, address, phone, whatsapp, currency, timezone, is_active, settings, created_at, updated_at) FROM stdin;
11111111-1111-1111-1111-111111111111	The Bread Chapter	the-bread-chapter	\N	FC Road, Shivajinagar, Pune 411005	+919876543210	+919876543210	INR	Asia/Kolkata	t	{"printers": {"kitchen": {"ip": "", "btDevice": "", "usbDevice": ""}, "beverage_counter": {"ip": "", "btDevice": "", "usbDevice": ""}}, "languages": ["en", "hi"], "accept_upi": true, "accept_card": false, "accept_cash": true, "tax_percent": 5, "show_social_proof": true, "service_charge_percent": 0}	2026-07-28 05:23:14.932867+00	2026-07-28 05:23:14.932867+00
\.
ALTER TABLE public.cafes ENABLE TRIGGER ALL;

-- ── Auth credentials ────────────────────────────────────────────────────────

ALTER TABLE public.auth_credentials DISABLE TRIGGER ALL;
COPY public.auth_credentials (id, user_id, password_hash, updated_at, role, display_name) FROM stdin;
9f4d5c80-d02d-449d-afa8-22dfd781be46	admin	$2b$10$H0E/iF000LPkWp/RseBDZO9hEEWHDdXsG7I8WKLYquuJfioC6agi6	2026-07-28 05:23:14.000000+00	admin	Administrator
da0a78ca-55a0-40e8-95c1-ec3a47cbd5dc	manager	$2b$10$CrQi97zTbx0yWOjhsBPCIe1Zk6y3LyLME6G2xpG0JdFwCIrSikfiq	2026-07-28 05:23:14.000000+00	manager	Manager
d94d0092-86e6-447e-b284-b4365df67f6f	staff	$2b$10$UIaybUC3jrTD6u2Ntx9ejOBy6S4cVi/O58uuxVw0qa.svKJCEggw6	2026-07-28 05:23:14.000000+00	staff	Staff
\.
ALTER TABLE public.auth_credentials ENABLE TRIGGER ALL;

-- ── Sections ────────────────────────────────────────────────────────────────

ALTER TABLE public.sections DISABLE TRIGGER ALL;
COPY public.sections (id, name, sort_order) FROM stdin;
1	Indoor	1
2	Outdoor	2
3	Smoking	3
\.
ALTER TABLE public.sections ENABLE TRIGGER ALL;

-- ── Tables ──────────────────────────────────────────────────────────────────

ALTER TABLE public.tables DISABLE TRIGGER ALL;
COPY public.tables (id, cafe_id, number, label, capacity, qr_code_url, is_active, created_at, section_id, status, shape) FROM stdin;
fb8f9c04-e5f2-40fc-8f4c-ab100afd6efd	11111111-1111-1111-1111-111111111111	1	Entrance	2	\N	t	2026-07-28 05:23:14.935907+00	1	free	square
77896cec-c9a9-49eb-a06b-687d4f9691f9	11111111-1111-1111-1111-111111111111	2	Window Seat	4	\N	t	2026-07-28 05:23:14.935907+00	1	free	square
a973439b-d1f8-4541-a3bd-9c3f3ed90369	11111111-1111-1111-1111-111111111111	3	Corner Booth	4	\N	t	2026-07-28 05:23:14.935907+00	1	free	square
04a2732d-79dc-4da5-ab66-146503ae5cd0	11111111-1111-1111-1111-111111111111	4	Outdoor	6	\N	t	2026-07-28 05:23:14.935907+00	2	free	square
a8dd20db-1ba9-47a9-a4d7-6bb540ada07e	11111111-1111-1111-1111-111111111111	5	Rooftop	4	\N	t	2026-07-28 05:23:14.935907+00	2	free	square
b5bfcb33-69b4-463b-bc32-c00e884d24c6	11111111-1111-1111-1111-111111111111	6	Bar Counter	3	\N	t	2026-07-28 05:23:14.935907+00	1	free	square
8e929221-b645-4b03-a056-797e74afbaff	11111111-1111-1111-1111-111111111111	7	Smoking 1	2	\N	t	2026-07-28 05:23:22.473107+00	3	free	square
b852bdd2-3b98-41ff-bed3-91caad21f48b	11111111-1111-1111-1111-111111111111	8	Smoking 2	2	\N	t	2026-07-28 05:23:22.473107+00	3	free	square
44425fbd-af8a-4053-8783-0648932a1782	11111111-1111-1111-1111-111111111111	9	\N	5	\N	t	2026-08-08 17:01:23.860684+00	1	free	round
\.
ALTER TABLE public.tables ENABLE TRIGGER ALL;

-- ── Menu categories ─────────────────────────────────────────────────────────

ALTER TABLE public.menu_categories DISABLE TRIGGER ALL;
COPY public.menu_categories (id, cafe_id, name, name_hi, description, image_url, sort_order, is_active, created_at) FROM stdin;
ca000001-0000-0000-0000-000000000001	11111111-1111-1111-1111-111111111111	Hot Beverages	गर्म पेय	\N	\N	1	t	2026-07-28 05:23:14.946476+00
ca000002-0000-0000-0000-000000000002	11111111-1111-1111-1111-111111111111	Cold Beverages	ठंडे पेय	\N	\N	2	t	2026-07-28 05:23:14.946476+00
ca000003-0000-0000-0000-000000000003	11111111-1111-1111-1111-111111111111	Snacks	स्नैक्स	\N	\N	3	t	2026-07-28 05:23:14.946476+00
ca000004-0000-0000-0000-000000000004	11111111-1111-1111-1111-111111111111	Breakfast	नाश्ता	\N	\N	4	t	2026-07-28 05:23:14.946476+00
ca000005-0000-0000-0000-000000000005	11111111-1111-1111-1111-111111111111	Desserts	मिठाई	\N	\N	5	t	2026-07-28 05:23:14.946476+00
\.
ALTER TABLE public.menu_categories ENABLE TRIGGER ALL;

-- ── Menu items ──────────────────────────────────────────────────────────────

ALTER TABLE public.menu_items DISABLE TRIGGER ALL;
COPY public.menu_items (id, cafe_id, category_id, name, name_hi, description, description_hi, price, image_url, is_veg, is_vegan, is_jain, contains_gluten, contains_nuts, spice_level, is_available, is_featured, sort_order, order_count, prep_time_mins, upsell_item_ids, created_at, updated_at, category, cost_price_paisa) FROM stdin;
b0951584-daa9-4588-84d1-89d4eae10a38	11111111-1111-1111-1111-111111111111	ca000001-0000-0000-0000-000000000001	Filter Coffee	फिल्टर कॉफी	South Indian style — served in a traditional dabara	\N	80.00	\N	t	f	f	t	f	0	t	f	0	95	4	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	beverage	0
2d92c01b-1596-4d99-ac0f-9ee022035635	11111111-1111-1111-1111-111111111111	ca000002-0000-0000-0000-000000000002	Mango Lassi	आम लस्सी	Fresh Alphonso mango, yoghurt, a pinch of cardamom	\N	110.00	\N	t	f	f	t	f	0	t	f	0	203	2	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	beverage	0
5800ffab-84e5-4bec-b4da-c8a37ac0413d	11111111-1111-1111-1111-111111111111	ca000001-0000-0000-0000-000000000001	Sunrise Signature Coffee	सनराइज सिग्नेचर कॉफी	Our house blend — smooth, strong, and just right	\N	120.00	\N	t	f	f	t	f	0	t	t	0	247	5	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	beverage	0
6f97f7b8-84c2-406a-a55e-4d8746c97115	11111111-1111-1111-1111-111111111111	ca000002-0000-0000-0000-000000000002	Watermelon Mint Cooler	तरबूज पुदीना कूलर	Fresh pressed watermelon with mint and sea salt	\N	130.00	\N	t	f	f	t	f	0	t	t	0	88	2	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	beverage	0
33a2ec01-b10f-41fc-94f7-45b778a75e46	11111111-1111-1111-1111-111111111111	ca000002-0000-0000-0000-000000000002	Iced Americano	\N	Chilled espresso and water for a crisp, clean coffee experience	\N	246.00	\N	t	f	f	t	f	0	t	f	40	0	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
07e08bdf-e4f2-429a-8f09-870b204f39ff	11111111-1111-1111-1111-111111111111	ca000002-0000-0000-0000-000000000002	Honeyed Americano	\N	Chilled espresso lightly sweetened with honey for a smooth, refreshing finish	\N	276.00	\N	t	f	f	t	f	0	t	f	50	0	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
0774e4e3-ee68-42fe-95ae-932d955ea058	11111111-1111-1111-1111-111111111111	ca000002-0000-0000-0000-000000000002	Iced Latte	\N	Smooth espresso and chilled milk crafted for effortless indulgence	\N	286.00	\N	t	f	f	t	f	0	t	t	60	0	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
98900cb4-56fd-4478-90c1-86320e4a5842	11111111-1111-1111-1111-111111111111	ca000002-0000-0000-0000-000000000002	Tiramisu Tonic	\N	Our signature espresso tonic infused with delicate tiramisu notes and sparkling elegance	\N	335.00	\N	t	f	f	t	f	0	t	t	70	0	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
1e38c2cd-b25a-47d6-a52e-a865e5c40721	11111111-1111-1111-1111-111111111111	ca000002-0000-0000-0000-000000000002	Café Ginger Fizz	\N	Espresso meets sparkling ginger with a bright citrus finish	\N	296.00	\N	t	f	f	t	f	0	t	t	10	1	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
8e85f7e5-2078-4cdf-88da-082fc3e1cb1f	11111111-1111-1111-1111-111111111111	ca000002-0000-0000-0000-000000000002	Espresso Tonique	\N	Crisp tonic water and espresso finished with refreshing citrus notes	\N	280.00	\N	t	f	f	t	f	0	t	f	20	1	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
bee6e174-f431-4931-aeca-60cf3db5711f	11111111-1111-1111-1111-111111111111	ca000002-0000-0000-0000-000000000002	Coke Espresso	\N	Bold espresso paired with cola and a lively hint of citrus	\N	350.00	\N	t	f	f	t	f	0	t	t	30	1	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
338ec745-e49b-40ce-9894-216252a23c27	11111111-1111-1111-1111-111111111111	ca000004-0000-0000-0000-000000000004	Poha	पोहा	Pune style flattened rice, curry leaves, peanuts, lime	\N	80.00	\N	t	f	f	t	f	1	t	t	0	221	10	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	food	0
a36dd21f-2d02-4f06-8066-789504f39de8	11111111-1111-1111-1111-111111111111	ca000005-0000-0000-0000-000000000005	Gulab Jamun	गुलाब जामुन	Classic, soft, rose-syrup soaked — served warm (2 pcs)	\N	90.00	\N	t	f	f	t	f	0	t	f	0	179	3	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	food	0
6d5170c7-f781-4705-b0e7-374f384ee5ff	11111111-1111-1111-1111-111111111111	ca000003-0000-0000-0000-000000000003	Cheese Toast	चीज़ टोस्ट	Thick sliced bread, melted cheese, herb butter	\N	90.00	\N	t	f	f	t	f	0	t	f	0	136	7	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	food	0
f4c5eddc-2627-44cc-b207-4d7fb57886d7	11111111-1111-1111-1111-111111111111	ca000005-0000-0000-0000-000000000005	Chocolate Brownie	चॉकलेट ब्राउनी	Warm, fudgy — served with a scoop of vanilla	\N	150.00	\N	t	f	f	t	f	0	t	t	0	160	5	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	food	0
cc95565a-8d76-41e3-b6ec-95d3755fcc7a	11111111-1111-1111-1111-111111111111	ca000001-0000-0000-0000-000000000001	Cappuccino	\N	Bold espresso crowned with silky milk foam for timeless comfort	\N	256.00	\N	t	f	f	t	f	0	t	f	40	7	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
4bea96b5-2840-4967-a548-bbd06113edea	11111111-1111-1111-1111-111111111111	ca000001-0000-0000-0000-000000000001	Latte	\N	Velvety steamed milk folded into rich espresso with a delicate creamy finish	\N	276.00	\N	t	f	f	t	f	0	t	t	30	10	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
84f3df08-6377-4f6c-b41c-ae0596ff149b	11111111-1111-1111-1111-111111111111	ca000004-0000-0000-0000-000000000004	English Breakfast	इंग्लिश ब्रेकफास्ट	Eggs your way, toast, grilled tomato, sautéed mushrooms	\N	280.00	\N	t	f	f	t	f	0	t	f	0	73	15	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	food	0
725267b5-d678-4ccc-9b81-37d165138c69	11111111-1111-1111-1111-111111111111	ca000003-0000-0000-0000-000000000003	Chocolate Croissant	चॉकलेट क्रोइसां	Buttery, flaky, dark chocolate filling — baked fresh	\N	120.00	\N	t	f	f	t	f	0	t	t	0	198	3	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	food	1600
243f1217-4976-46ec-8cf9-8d2ff7560f16	11111111-1111-1111-1111-111111111111	ca000002-0000-0000-0000-000000000002	Cold Brew	कोल्ड ब्रू	18-hour steeped, served over ice	\N	160.00	\N	t	f	f	t	f	0	t	t	0	164	0	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	beverage	1210
c6cc61be-9602-448d-9db4-153033ea948a	11111111-1111-1111-1111-111111111111	ca000001-0000-0000-0000-000000000001	Caramel Latte	कैरामल लट्टे	Espresso with steamed milk and house caramel drizzle	\N	150.00	\N	t	f	f	t	f	0	t	t	0	228	5	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	beverage	0
3e424a3d-195f-4a13-b887-67012cf6c829	11111111-1111-1111-1111-111111111111	ca000003-0000-0000-0000-000000000003	Vada Pav	वडा पाव	Mumbai style — spicy potato vada, green chutney, pav	\N	50.00	\N	t	f	f	t	f	2	t	f	0	322	5	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	food	0
fea76353-c809-42e8-9d80-9cdca5b8bdb3	11111111-1111-1111-1111-111111111111	ca000001-0000-0000-0000-000000000001	Espresso	\N	Bold, velvety espresso with an intense aroma and a lingering finish	\N	196.00	\N	t	f	f	t	f	0	t	f	10	12	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
8ed41962-0285-4dcf-ac0a-f30b33c7223e	11111111-1111-1111-1111-111111111111	ca000001-0000-0000-0000-000000000001	Masala Chai	मसाला चाय	Ginger, cardamom, and Assam tea — the real deal	\N	60.00	\N	t	f	f	t	f	1	t	f	0	326	3	{}	2026-07-28 05:23:14.948364+00	2026-07-28 05:23:14.948364+00	beverage	1050
7345efbd-ca7c-4348-809f-6b71cb3d70c7	11111111-1111-1111-1111-111111111111	ca000001-0000-0000-0000-000000000001	Americano	\N	Rich espresso gently extended with hot water for a smooth, balanced cup	\N	236.00	\N	t	f	f	t	f	0	t	f	20	8	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
26aa3487-518a-44dc-bef6-a0a7076aaad1	11111111-1111-1111-1111-111111111111	ca000001-0000-0000-0000-000000000001	Mocha	\N	Rich chocolate and bold espresso blended beneath silky steamed milk	\N	296.00	\N	t	f	f	t	f	0	t	t	50	10	5	{}	2026-08-05 10:01:54.310688+00	2026-08-05 10:01:54.310688+00	beverage	0
\.
ALTER TABLE public.menu_items ENABLE TRIGGER ALL;
