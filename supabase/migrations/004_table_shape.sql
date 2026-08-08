-- M6+ : add shape to tables so the POS floor view can render the correct
-- table icon (round / square / rectangle) with seats drawn around it.

ALTER TABLE tables
  ADD COLUMN shape TEXT NOT NULL DEFAULT 'square'
    CHECK (shape IN ('round', 'square', 'rectangle'));
