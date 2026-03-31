-- Stripe Connect: add fields to studios
ALTER TABLE studios ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE studios ADD COLUMN IF NOT EXISTS stripe_onboarding_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE studios ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE studios ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN DEFAULT FALSE;

-- Deposit tracking on appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS deposit_status TEXT DEFAULT 'none';

-- Payment records
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID REFERENCES studios(id),
  appointment_id UUID REFERENCES appointments(id),
  customer_id UUID REFERENCES customers(id),
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  amount NUMERIC NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending',
  payment_type TEXT DEFAULT 'deposit',
  checkout_url TEXT,
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_appointment_idx ON payments(appointment_id);
CREATE INDEX IF NOT EXISTS payments_studio_idx ON payments(studio_id);
CREATE INDEX IF NOT EXISTS payments_stripe_session_idx ON payments(stripe_checkout_session_id);

CREATE TRIGGER set_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- RLS for payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments
FOR SELECT USING (studio_id = public.current_user_studio());

DROP POLICY IF EXISTS payments_insert ON public.payments;
CREATE POLICY payments_insert ON public.payments
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS payments_update ON public.payments;
CREATE POLICY payments_update ON public.payments
FOR UPDATE USING (studio_id = public.current_user_studio());

DROP POLICY IF EXISTS payments_delete ON public.payments;
CREATE POLICY payments_delete ON public.payments
FOR DELETE USING (
  studio_id = public.current_user_studio()
  AND public.current_user_role() IN ('Owner', 'Admin')
);
