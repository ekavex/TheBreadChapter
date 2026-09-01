-- M10.1 - Menu item variants (e.g. Full Cake / Slice)
-- variants is a nullable JSONB array: [{ label: string, price: number }, ...]
-- null means no variants (item behaves as today).
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT NULL;
