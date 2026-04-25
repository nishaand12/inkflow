-- Phase 1: Commerce, reporting categories, products, line-item charges,
-- artist split rules, daily settlements, and appointment health fields.

-- Reporting categories: studio-configurable (not hard-coded).
-- category_type helps group categories for UI/reporting (service, item, store_credit).
CREATE TABLE IF NOT EXISTS reporting_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID REFERENCES studios(id),
  name TEXT NOT NULL,
  category_type TEXT NOT NULL DEFAULT 'item',
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reporting_categories_studio_idx ON reporting_categories(studio_id);

CREATE TRIGGER set_reporting_categories_updated_at
BEFORE UPDATE ON reporting_categories
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Products: inventory items with optional barcode/SKU for scanner input.
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID REFERENCES studios(id),
  reporting_category_id UUID REFERENCES reporting_categories(id),
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  cost NUMERIC,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_studio_idx ON products(studio_id);
CREATE INDEX IF NOT EXISTS products_barcode_idx ON products(studio_id, barcode);
CREATE INDEX IF NOT EXISTS products_sku_idx ON products(studio_id, sku);

CREATE TRIGGER set_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Appointment charges: line items attached to an appointment at checkout.
-- Snapshots category name so historical reports survive renames.
CREATE TABLE IF NOT EXISTS appointment_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID REFERENCES studios(id),
  appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL DEFAULT 'product',
  reporting_category_id UUID REFERENCES reporting_categories(id),
  reporting_category_name TEXT,
  product_id UUID REFERENCES products(id),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointment_charges_appointment_idx ON appointment_charges(appointment_id);
CREATE INDEX IF NOT EXISTS appointment_charges_studio_idx ON appointment_charges(studio_id);

CREATE TRIGGER set_appointment_charges_updated_at
BEFORE UPDATE ON appointment_charges
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Artist split rules: configurable per artist with eligible category set.
CREATE TABLE IF NOT EXISTS artist_split_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID REFERENCES studios(id),
  artist_id UUID REFERENCES artists(id),
  split_percent NUMERIC NOT NULL DEFAULT 50,
  eligible_category_ids UUID[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artist_split_rules_studio_idx ON artist_split_rules(studio_id);
CREATE INDEX IF NOT EXISTS artist_split_rules_artist_idx ON artist_split_rules(artist_id);

CREATE TRIGGER set_artist_split_rules_updated_at
BEFORE UPDATE ON artist_split_rules
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Daily settlements: frozen payout records per day/location.
CREATE TABLE IF NOT EXISTS daily_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID REFERENCES studios(id),
  location_id UUID REFERENCES locations(id),
  settlement_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  gross_total NUMERIC NOT NULL DEFAULT 0,
  tax_total NUMERIC NOT NULL DEFAULT 0,
  discount_total NUMERIC NOT NULL DEFAULT 0,
  net_total NUMERIC NOT NULL DEFAULT 0,
  pos_collected NUMERIC NOT NULL DEFAULT 0,
  online_collected NUMERIC NOT NULL DEFAULT 0,
  gift_card_sales NUMERIC NOT NULL DEFAULT 0,
  gift_card_returns NUMERIC NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  locked_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_settlements_unique_idx
  ON daily_settlements(studio_id, location_id, settlement_date);
CREATE INDEX IF NOT EXISTS daily_settlements_studio_date_idx
  ON daily_settlements(studio_id, settlement_date);

CREATE TRIGGER set_daily_settlements_updated_at
BEFORE UPDATE ON daily_settlements
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Settlement line items: per-artist frozen split for a given settlement.
CREATE TABLE IF NOT EXISTS daily_settlement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID REFERENCES studios(id),
  settlement_id UUID REFERENCES daily_settlements(id) ON DELETE CASCADE,
  artist_id UUID REFERENCES artists(id),
  appointment_id UUID REFERENCES appointments(id),
  gross_amount NUMERIC NOT NULL DEFAULT 0,
  artist_share NUMERIC NOT NULL DEFAULT 0,
  shop_share NUMERIC NOT NULL DEFAULT 0,
  split_percent NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_settlement_lines_settlement_idx ON daily_settlement_lines(settlement_id);
CREATE INDEX IF NOT EXISTS daily_settlement_lines_artist_idx ON daily_settlement_lines(artist_id);

-- Extend appointment_types: public booking flag and reporting category link.
ALTER TABLE appointment_types ADD COLUMN IF NOT EXISTS is_public_bookable BOOLEAN DEFAULT FALSE;
ALTER TABLE appointment_types ADD COLUMN IF NOT EXISTS reporting_category_id UUID REFERENCES reporting_categories(id);

-- Extend appointments: health fields (JSONB) for needle lot, clinical metadata.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS health_fields JSONB DEFAULT '{}';

-- Extend appointments: discount tracking at appointment level.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0;
