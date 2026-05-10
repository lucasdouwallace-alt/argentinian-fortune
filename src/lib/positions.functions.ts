import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALPACA_DATA = "https://data.alpaca.markets";

function alpacaHeaders() {
  const k = process.env.ALPACA_API_KEY;
  const s = process.env.ALPACA_SECRET_KEY;
  if (!k || !s) throw new Error("Alpaca keys not configured");
  return { "APCA-API-KEY-ID": k, "APCA-API-SECRET-KEY": s };
}

async function fetchLivePriceUsd(ticker: string): Promise<number> {
  // Try latest quote (mid), fall back to latest trade.
  const q = await fetch(
    `${ALPACA_DATA}/v2/stocks/quotes/latest?symbols=${ticker}&feed=iex`,
    { headers: alpacaHeaders() }
  );
  if (q.ok) {
    const j = (await q.json()) as { quotes: Record<string, { ap: number; bp: number }> };
    const row = j.quotes?.[ticker];
    if (row) {
      const mid = row.ap && row.bp ? (row.ap + row.bp) / 2 : row.ap || row.bp;
      if (mid > 0) return mid;
    }
  }
  const t = await fetch(
    `${ALPACA_DATA}/v2/stocks/trades/latest?symbols=${ticker}&feed=iex`,
    { headers: alpacaHeaders() }
  );
  if (!t.ok) throw new Error(`Alpaca price ${t.status}`);
  const tj = (await t.json()) as { trades: Record<string, { p: number }> };
  const p = tj.trades?.[ticker]?.p;
  if (!p || p <= 0) throw new Error("Sin precio disponible");
  return p;
}

async function fetchFx(): Promise<{ ccl: number; mep: number }> {
  const [cclR, mepR] = await Promise.allSettled([
    fetch("https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoConLiqui"),
    fetch("https://api.argentinadatos.com/v1/cotizaciones/dolares/mep"),
  ]);
  let ccl = 0, mep = 0;
  if (cclR.status === "fulfilled" && cclR.value.ok) {
    const arr = (await cclR.value.json()) as Array<{ venta: number }>;
    ccl = arr[arr.length - 1]?.venta ?? 0;
  }
  if (mepR.status === "fulfilled" && mepR.value.ok) {
    const arr = (await mepR.value.json()) as Array<{ venta: number }>;
    mep = arr[arr.length - 1]?.venta ?? 0;
  }
  return { ccl, mep };
}

const tickerSchema = z.string().trim().toUpperCase().min(1).max(10).regex(/^[A-Z.]+$/);

export const openPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ticker: string; quantity: number }) =>
    z.object({
      ticker: tickerSchema,
      quantity: z.number().positive().max(1_000_000),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [price, fx] = await Promise.all([
      fetchLivePriceUsd(data.ticker),
      fetchFx().catch(() => ({ ccl: 0, mep: 0 })),
    ]);
    const entry_price_ars = fx.mep ? price * fx.mep : null;
    const { data: row, error } = await supabase
      .from("positions")
      .insert({
        user_id: userId,
        ticker: data.ticker,
        quantity: data.quantity,
        entry_price_usd: price,
        entry_price_ars,
        mep_at_entry: fx.mep || null,
        ccl_at_entry: fx.ccl || null,
        status: "open",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, ticker: row.ticker, entry_price_usd: price, quantity: data.quantity };
  });

export const closePosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: pos, error: fErr } = await supabase
      .from("positions")
      .select("ticker, entry_price_usd, quantity, status")
      .eq("id", data.id)
      .maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (!pos) throw new Error("Posición no encontrada");
    if (pos.status !== "open") throw new Error("Posición ya cerrada");

    const exit_price_usd = await fetchLivePriceUsd(pos.ticker);
    const pnl_usd = (exit_price_usd - Number(pos.entry_price_usd)) * Number(pos.quantity);
    const pnl_pct = (exit_price_usd / Number(pos.entry_price_usd) - 1) * 100;

    const { error: uErr } = await supabase
      .from("positions")
      .update({
        status: "closed",
        exit_price_usd,
        exit_date: new Date().toISOString(),
        pnl_usd,
        pnl_pct,
      })
      .eq("id", data.id);
    if (uErr) throw new Error(uErr.message);
    return { exit_price_usd, pnl_usd, pnl_pct };
  });
