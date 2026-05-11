import { createServerFn } from "@tanstack/react-start";

const TICKERS = ["VIST", "MELI", "NVDA", "BMA", "PLTR", "GOOGL", "AAPL", "MSFT", "GGAL", "YPF"];

const ALPACA_DATA = "https://data.alpaca.markets";
const ALPACA_API = "https://api.alpaca.markets";

function alpacaHeaders() {
  const k = process.env.ALPACA_API_KEY;
  const s = process.env.ALPACA_SECRET_KEY;
  if (!k || !s) throw new Error("Alpaca keys no configuradas");
  return { "APCA-API-KEY-ID": k, "APCA-API-SECRET-KEY": s };
}

export type AssetQuote = {
  ticker: string;
  price_usd: number;
  change_pct: number;
  ts: string;
};

export type MarketSnapshot = {
  is_open: boolean;
  next_open?: string;
  next_close?: string;
  ccl: number;
  mep: number;
  fx_updated_at: string;
  quotes: AssetQuote[];
};

async function fetchClock() {
  try {
    const r = await fetch(`${ALPACA_API}/v2/clock`, { headers: alpacaHeaders() });
    if (!r.ok) return { is_open: false };
    return (await r.json()) as { is_open: boolean; next_open: string; next_close: string };
  } catch {
    return { is_open: false };
  }
}

async function fetchQuotes(): Promise<Record<string, { ap: number }>> {
  const symbols = TICKERS.join(",");
  const r = await fetch(
    `${ALPACA_DATA}/v2/stocks/quotes/latest?symbols=${symbols}&feed=iex`,
    { headers: alpacaHeaders() }
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Alpaca quotes ${r.status}: ${txt}`);
  }
  const j = (await r.json()) as { quotes: Record<string, { ap: number; bp: number; t: string }> };
  return j.quotes;
}

async function fetchBars(): Promise<Record<string, { o: number; c: number }>> {
  const symbols = TICKERS.join(",");
  const r = await fetch(
    `${ALPACA_DATA}/v2/stocks/bars/latest?symbols=${symbols}&feed=iex`,
    { headers: alpacaHeaders() }
  );
  if (!r.ok) return {};
  const j = (await r.json()) as { bars: Record<string, { o: number; c: number }> };
  return j.bars || {};
}

async function fetchFx(): Promise<{ ccl: number; mep: number }> {
  const [cclRes, mepRes] = await Promise.allSettled([
    fetch("https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoConLiqui"),
    fetch("https://api.argentinadatos.com/v1/cotizaciones/dolares/mep"),
  ]);
  let ccl = 0, mep = 0;
  if (cclRes.status === "fulfilled" && cclRes.value.ok) {
    const arr = (await cclRes.value.json()) as Array<{ venta: number }>;
    ccl = arr[arr.length - 1]?.venta ?? 0;
  }
  if (mepRes.status === "fulfilled" && mepRes.value.ok) {
    const arr = (await mepRes.value.json()) as Array<{ venta: number }>;
    mep = arr[arr.length - 1]?.venta ?? 0;
  }
  return { ccl, mep };
}

export const getMarketSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<MarketSnapshot> => {
    const [clock, quotes, bars, fx] = await Promise.all([
      fetchClock(),
      fetchQuotes().catch((e) => {
        console.error("quotes failed", e);
        return {} as Record<string, { ap: number }>;
      }),
      fetchBars().catch(() => ({} as Record<string, { o: number; c: number }>)),
      fetchFx().catch(() => ({ ccl: 0, mep: 0 })),
    ]);

    const ts = new Date().toISOString();
    const out: AssetQuote[] = TICKERS.map((t) => {
      const q = quotes[t];
      const b = bars[t];
      const price = q?.ap || b?.c || 0;
      const change_pct = b && b.o > 0 ? ((b.c - b.o) / b.o) * 100 : 0;
      return { ticker: t, price_usd: price, change_pct, ts };
    });

    return {
      is_open: clock.is_open,
      next_open: (clock as { next_open?: string }).next_open,
      next_close: (clock as { next_close?: string }).next_close,
      ccl: fx.ccl,
      mep: fx.mep,
      fx_updated_at: ts,
      quotes: out,
    };
  }
);
