-- ============================================================
-- SEED: The Bread Chapter (Demo client — Pune)
-- Run: supabase db seed  OR paste in SQL Editor
-- ============================================================

INSERT INTO cafes (id, name, slug, address, phone, whatsapp) VALUES
  ('11111111-1111-1111-1111-111111111111',
   'The Bread Chapter', 'the-bread-chapter',
   'FC Road, Shivajinagar, Pune 411005',
   '+919876543210', '+919876543210');

-- Tables
INSERT INTO tables (cafe_id, number, label, capacity) VALUES
  ('11111111-1111-1111-1111-111111111111', 1, 'Entrance', 2),
  ('11111111-1111-1111-1111-111111111111', 2, 'Window Seat', 4),
  ('11111111-1111-1111-1111-111111111111', 3, 'Corner Booth', 4),
  ('11111111-1111-1111-1111-111111111111', 4, 'Outdoor', 6),
  ('11111111-1111-1111-1111-111111111111', 5, 'Rooftop', 4),
  ('11111111-1111-1111-1111-111111111111', 6, 'Bar Counter', 3);

-- Categories
INSERT INTO menu_categories (id, cafe_id, name, name_hi, sort_order) VALUES
  ('ca000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Hot Beverages', 'गर्म पेय', 1),
  ('ca000002-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Cold Beverages', 'ठंडे पेय', 2),
  ('ca000003-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Snacks', 'स्नैक्स', 3),
  ('ca000004-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Breakfast', 'नाश्ता', 4),
  ('ca000005-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Desserts', 'मिठाई', 5);

-- Menu Items
INSERT INTO menu_items (cafe_id, category_id, name, name_hi, description, price, is_veg, is_featured, order_count, prep_time_mins, spice_level) VALUES
  -- Hot Beverages
  ('11111111-1111-1111-1111-111111111111', 'ca000001-0000-0000-0000-000000000001',
   'Sunrise Signature Coffee', 'सनराइज सिग्नेचर कॉफी',
   'Our house blend — smooth, strong, and just right', 120, true, true, 247, 5, 0),

  ('11111111-1111-1111-1111-111111111111', 'ca000001-0000-0000-0000-000000000001',
   'Caramel Latte', 'कैरामल लट्टे',
   'Espresso with steamed milk and house caramel drizzle', 150, true, true, 189, 5, 0),

  ('11111111-1111-1111-1111-111111111111', 'ca000001-0000-0000-0000-000000000001',
   'Masala Chai', 'मसाला चाय',
   'Ginger, cardamom, and Assam tea — the real deal', 60, true, false, 312, 3, 1),

  ('11111111-1111-1111-1111-111111111111', 'ca000001-0000-0000-0000-000000000001',
   'Filter Coffee', 'फिल्टर कॉफी',
   'South Indian style — served in a traditional dabara', 80, true, false, 95, 4, 0),

  -- Cold Beverages
  ('11111111-1111-1111-1111-111111111111', 'ca000002-0000-0000-0000-000000000002',
   'Cold Brew', 'कोल्ड ब्रू',
   '18-hour steeped, served over ice', 160, true, true, 142, 0, 0),

  ('11111111-1111-1111-1111-111111111111', 'ca000002-0000-0000-0000-000000000002',
   'Mango Lassi', 'आम लस्सी',
   'Fresh Alphonso mango, yoghurt, a pinch of cardamom', 110, true, false, 203, 2, 0),

  ('11111111-1111-1111-1111-111111111111', 'ca000002-0000-0000-0000-000000000002',
   'Watermelon Mint Cooler', 'तरबूज पुदीना कूलर',
   'Fresh pressed watermelon with mint and sea salt', 130, true, true, 88, 2, 0),

  -- Snacks
  ('11111111-1111-1111-1111-111111111111', 'ca000003-0000-0000-0000-000000000003',
   'Chocolate Croissant', 'चॉकलेट क्रोइसां',
   'Buttery, flaky, dark chocolate filling — baked fresh', 120, true, true, 176, 3, 0),

  ('11111111-1111-1111-1111-111111111111', 'ca000003-0000-0000-0000-000000000003',
   'Vada Pav', 'वडा पाव',
   'Mumbai style — spicy potato vada, green chutney, pav', 50, true, false, 298, 5, 2),

  ('11111111-1111-1111-1111-111111111111', 'ca000003-0000-0000-0000-000000000003',
   'Cheese Toast', 'चीज़ टोस्ट',
   'Thick sliced bread, melted cheese, herb butter', 90, true, false, 134, 7, 0),

  -- Breakfast
  ('11111111-1111-1111-1111-111111111111', 'ca000004-0000-0000-0000-000000000004',
   'English Breakfast', 'इंग्लिश ब्रेकफास्ट',
   'Eggs your way, toast, grilled tomato, sautéed mushrooms', 280, true, false, 67, 15, 0),

  ('11111111-1111-1111-1111-111111111111', 'ca000004-0000-0000-0000-000000000004',
   'Poha', 'पोहा',
   'Pune style flattened rice, curry leaves, peanuts, lime', 80, true, true, 221, 10, 1),

  -- Desserts
  ('11111111-1111-1111-1111-111111111111', 'ca000005-0000-0000-0000-000000000005',
   'Chocolate Brownie', 'चॉकलेट ब्राउनी',
   'Warm, fudgy — served with a scoop of vanilla', 150, true, true, 159, 5, 0),

  ('11111111-1111-1111-1111-111111111111', 'ca000005-0000-0000-0000-000000000005',
   'Gulab Jamun', 'गुलाब जामुन',
   'Classic, soft, rose-syrup soaked — served warm (2 pcs)', 90, true, false, 178, 3, 0);
