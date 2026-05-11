-- price_alerts: notificaciones cuando una crypto llega a un precio
CREATE TABLE public.price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ticker TEXT NOT NULL,
  target_price NUMERIC NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('above','below')),
  is_triggered BOOLEAN NOT NULL DEFAULT false,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own price alerts all"
ON public.price_alerts
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_price_alerts_user_active
  ON public.price_alerts (user_id, is_triggered);

-- crypto_trades: trades de crypto seguidos por el usuario
CREATE TABLE public.crypto_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  ticker TEXT NOT NULL,
  signal TEXT NOT NULL,
  entry_price_usd NUMERIC NOT NULL,
  stop_price_usd NUMERIC NOT NULL,
  target_price_usd NUMERIC NOT NULL,
  capital_usd NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','closed')),
  exit_price_usd NUMERIC,
  pnl_usd NUMERIC,
  pnl_pct NUMERIC,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crypto_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own crypto trades all"
ON public.crypto_trades
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_crypto_trades_user_status
  ON public.crypto_trades (user_id, status, created_at DESC);