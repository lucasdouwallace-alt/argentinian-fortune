import { createServerFn } from "@tanstack/react-start";
import { ORACULO_SYSTEM_PROMPT } from "@/lib/oraculoPrompt";
import {
  getCryptoTechnicalsBatch,
  getCryptoChartBars,
  type CryptoTechnicals,
  type ChartBar,
} from "@/lib/technicals.server";
import { z } from "zod";
import { getCachedAnalysis, setCachedAnalysis } from "@/lib/analysisCache";

const ALPACA_DATA = "https://data.alpaca.markets";

function alpacaHeaders() {
  const k = process.env.ALPACA_API_KEY;
  const s = process.env.ALPACA_SECRET_KEY;
  if (!k || !s) throw new Error("Alpaca keys no configuradas");
  return { "APCA-API-KEY-ID": k, "APCA-API-SECRET-KEY": s };
}

export const CRYPTO_SYMBOLS = [
  "BTC/USD",
  "ETH/USD",
  "SOL/USD",
  "XRP/USD",
  "ADA/USD",
  "AVAX/USD",
  "DOGE/USD",
  "LINK/USD",
  "LTC/USD",
  "UNI/USD",
  "DOT/USD",
  "BCH/USD",
  "ETC/USD",
  "XLM/USD",
  "AAVE/USD",
  "ALGO/USD",
  "MATIC/USD",
  "ATOM/USD",
  "FIL/USD",
];

export const CRYPTO_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  XRP: "XRP",
  ADA: "Cardano",
  AVAX: "Avalanche",
  DOGE: "Dogecoin",
  LINK: "Chainlink",
  LTC: "Litecoin",
  UNI: "Uniswap",
  DOT: "Polkadot",
  BCH: "Bitcoin Cash",
  ETC: "Ethereum Classic",
  XLM: "Stellar",
  AAVE: "Aave",
  ALGO: "Algorand",
  MATIC: "Polygon",
  ATOM: "Cosmos",
  FIL: "Filecoin",
};

export type CryptoQuote = {
  ticker: string;
  symbol: string;
  name: string;
  price_usd: number;
  change_24h_pct: number;
  volume_24h: number;
  ts: string;
};

export type CryptoSignal = {
  ticker: string;
  signal: "COMPRAR" | "VENDER" | "ESPERAR";
  entry_price_usd: number;
  stop_price_usd: number;
  target_price_usd: number;
  stop_pct: number;
  target_pct: number;
  horizon: string;
  probability_pct: number;
  reason: string;
  rsi?: number | null;
  rsi_label?: "SOBREVENDIDO" | "NEUTRO" | "SOBRECOMPRADO" | "N/D";
  macd_state?: "alcista" | "bajista" | "neutral";
  bb_position?: "upper" | "middle" | "lower";
  support?: number | null;
  resistance?: number | null;
  validation_corrected?: boolean;
};

export function validateCryptoSignal<S extends CryptoSignal>(sig: S): S {
  const entry = Number(sig.entry_price_usd) || 0;
  if (entry <= 0) return sig;
  let stop = Number(sig.stop_price_usd) || 0;
  let target = Number(sig.target_price_usd) || 0;
  let corrected = false;

  if (sig.signal === "COMPRAR") {
    if (stop <= 0 || stop >= entry) { stop = +(entry * 0.94).toFixed(8); corrected = true; }
    if (target <= 0 || target <= entry) { target = +(entry * 1.12).toFixed(8); corrected = true; }
  } else if (sig.signal === "VENDER") {
    if (stop <= 0 || stop <= entry) { stop = +(entry * 1.06).toFixed(8); corrected = true; }
    if (target <= 0 || target >= entry) { target = +(entry * 0.88).toFixed(8); corrected = true; }
  } else {
    if (target <= entry * 1.03) { target = +(entry * 1.12).toFixed(8); corrected = true; }
    if (stop <= 0 || stop >= entry) { stop = +(entry * 0.9).toFixed(8); corrected = true; }
  }

  const stopPct = ((stop - entry) / entry) * 100;
  const targetPct = ((target - entry) / entry) * 100;
  return {
    ...sig,
    stop_price_usd: stop,
    target_price_usd: target,
    stop_pct: +stopPct.toFixed(2),
    target_pct: +targetPct.toFixed(2),
    validation_corrected: corrected || sig.validation_corrected,
  };
}

export type CryptoMarket = {
  fear_greed: { value: number; label: string } | null;
  btc_dominance: number | null;
  generated_at: string;
};

export type CryptoSnapshot = {
  market: CryptoMarket;
  quotes: CryptoQuote[];
};

async function fetchCryptoQuotes(): Promise<Record<string, { ap?: number; bp?: number; t?: string }>> {
  const symbols = encodeURIComponent(CRYPTO_SYMBOLS.join(","));
  const r = await fetch(
    `${ALPACA_DATA}/v1beta3/crypto/us/latest/quotes?symbols=${symbols}`,
    { headers: alpacaHeaders() },
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Alpaca crypto quotes ${r.status}: ${t}`);
  }
  const j = (await r.json()) as { quotes: Record<string, { ap?: number; bp?: number; t?: string }> };
  return j.quotes || {};
}

async function fetchCryptoBars(): Promise<Record<string, { o?: number; c?: number; v?: number }>> {
  const symbols = encodeURIComponent(CRYPTO_SYMBOLS.join(","));
  const r = await fetch(
    `${ALPACA_DATA}/v1beta3/crypto/us/latest/bars?symbols=${symbols}`,
    { headers: alpacaHeaders() },
  );
  if (!r.ok) return {};
  const j = (await r.json()) as { bars: Record<string, { o?: number; c?: number; v?: number }> };
  return j.bars || {};
}

async function fetchFearGreed(): Promise<{ value: number; label: string } | null> {
  try {
    const r = await fetch("https://api.alternative.me/fng/", { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { data: Array<{ value: string; value_classification: string }> };
    const d = j.data?.[0];
    if (!d) return null;
    return { value: Number(d.value) || 0, label: d.value_classification || "" };
  } catch {
    return null;
  }
}

async function fetchBtcDominance(): Promise<number | null> {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/global", { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { data: { market_cap_percentage: { btc: number } } };
    return j.data?.market_cap_percentage?.btc ?? null;
  } catch {
    return null;
  }
}

async function buildQuotes(): Promise<{ quotes: CryptoQuote[]; market: CryptoMarket }> {
  const [quotes, bars, fg, dom] = await Promise.all([
    fetchCryptoQuotes().catch(() => ({} as Record<string, { ap?: number; bp?: number; t?: string }>)),
    fetchCryptoBars().catch(() => ({} as Record<string, { o?: number; c?: number; v?: number }>)),
    fetchFearGreed(),
    fetchBtcDominance(),
  ]);
  const ts = new Date().toISOString();
  const out: CryptoQuote[] = CRYPTO_SYMBOLS.map((sym) => {
    const ticker = sym.split("/")[0];
    const q = quotes[sym];
    const b = bars[sym];
    const price = q?.ap || b?.c || 0;
    const open = b?.o || 0;
    const change = open > 0 ? ((price - open) / open) * 100 : 0;
    return {
      ticker,
      symbol: sym,
      name: CRYPTO_NAMES[ticker] || ticker,
      price_usd: price,
      change_24h_pct: change,
      volume_24h: b?.v || 0,
      ts,
    };
  });
  return { quotes: out, market: { fear_greed: fg, btc_dominance: dom, generated_at: ts } };
}

export const getCryptoSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<CryptoSnapshot> => buildQuotes(),
);

export const analyzeCrypto = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    force: z.boolean().optional().default(false),
    user_id: z.string().optional(),
  }))
  .handler(async ({ data }): Promise<{ market: CryptoMarket; signals: CryptoSignal[]; cache_age_min?: number }> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

    // Cache: si no es force refresh y hay un análisis reciente, devolverlo
    if (!data.force && data.user_id) {
      const cached = await getCachedAnalysis<{ market: CryptoMarket; signals: CryptoSignal[] }>(data.user_id, "crypto");
      if (cached) {
        const minutes = Math.round(cached.age_ms / 60_000);
        console.log(`[crypto] cache hit (${minutes} min old)`);
        return { ...cached.data, cache_age_min: minutes };
      }
    }

    const snap = await buildQuotes();
    const validSymbols = snap.quotes.filter((q) => q.price_usd > 0).map((q) => q.symbol);
    const technicals = await getCryptoTechnicalsBatch(validSymbols).catch(
      () => ({} as Record<string, CryptoTechnicals>),
    );

    function macdState(t?: CryptoTechnicals): "alcista" | "bajista" | "neutral" {
      const m = t?.macd;
      if (!m) return "neutral";
      if (m.crossover) return "alcista";
      if (m.crossunder) return "bajista";
      return m.histogram > 0 ? "alcista" : m.histogram < 0 ? "bajista" : "neutral";
    }

    const lines = snap.quotes
      .filter((q) => q.price_usd > 0)
      .map((q) => {
        const t = technicals[q.symbol];
        const rsi = t?.rsi != null ? `RSI ${t.rsi} (${t.rsiLabel})` : "RSI N/D";
        const macd = t?.macd
          ? `MACD ${macdState(t)}${t.macd.crossover ? " (cruce↑)" : t.macd.crossunder ? " (cruce↓)" : ""}`
          : "MACD N/D";
        const bb = t?.bb ? `BB ${t.bb.position}` : "BB N/D";
        const sr = t?.sr ? `sop ${t.sr.support} res ${t.sr.resistance}` : "";
        const vol = t?.relativeVolume ? `vol ${t.relativeVolume.toFixed(2)}x` : `vol ${q.volume_24h.toFixed(0)}`;
        return `${q.ticker}: $${q.price_usd.toLocaleString("en-US", { maximumFractionDigits: 8 })} | 24h ${q.change_24h_pct >= 0 ? "+" : ""}${q.change_24h_pct.toFixed(2)}% | ${rsi} | ${macd} | ${bb} | ${sr} | ${vol}`;
      })
      .join("\n");

    const fg = snap.market.fear_greed;
    const dom = snap.market.btc_dominance;

    const userPrompt = `Sos el Oráculo, trader cuantitativo de crypto. Datos en vivo (Alpaca):
${lines}

Fear & Greed: ${fg ? `${fg.value} (${fg.label})` : "n/d"}
Dominancia BTC: ${dom != null ? dom.toFixed(2) + "%" : "n/d"}
Hora UTC: ${new Date().toISOString()}

REGLAS DE TRADING:
COMPRAR — necesita 3+ confirmaciones: RSI<35, MACD cruce alcista, BB lower, soporte clave, vol>1.3x, Fear&Greed<40
VENDER — necesita 2+ confirmaciones: RSI>68, MACD cruce bajista, BB upper, resistencia clave
ESPERAR cuando RSI 40-60, BB middle, MACD neutral

REGLA DE STOP/TARGET:
- COMPRAR: stop < entry, target > entry
- VENDER: stop > entry, target < entry
- ESPERAR: target >= entry × 1.05, stop < entry

Devolvé SOLO JSON sin texto extra ni backticks:
{
  "signals": [
    {
      "ticker": "BTC",
      "signal": "COMPRAR|VENDER|ESPERAR",
      "entry_price_usd": número exacto USD,
      "stop_price_usd": número exacto USD,
      "target_price_usd": número exacto USD,
      "stop_pct": número,
      "target_pct": número,
      "horizon": "ej: 2-4 horas | 1-3 días | 3-7 días",
      "probability_pct": 60-90,
      "reason": "máximo 18 palabras citando RSI + MACD + BB"
    }
  ]
}

Generá señal para TODAS las cryptos con precio > 0.`;

    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        temperature: 0.1,
        messages: [
          { role: "system", content: ORACULO_SYSTEM_PROMPT + "\n\nIMPORTANTE: para esta llamada respondé SOLO JSON válido, sin formato visual." },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (r.status === 429) throw new Error("Límite de requests alcanzado.");
    if (r.status === 402) throw new Error("Sin créditos en Gemini. Revisá tu quota en Google AI Studio.");
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);

    const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
    let text = j.choices[0]?.message?.content || "{}";
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) text = text.slice(start, end + 1);

    let parsed: { signals: CryptoSignal[] };
    try {
      parsed = JSON.parse(text) as { signals: CryptoSignal[] };
    } catch {
      console.error("crypto parse failed", text);
      throw new Error("La IA devolvió un formato inválido");
    }

    const priceByTicker = new Map(snap.quotes.map((q) => [q.ticker, q.price_usd]));
    parsed.signals = (parsed.signals || []).map((s) => {
      const cur = priceByTicker.get(s.ticker) || 0;
      const entry = Number(s.entry_price_usd) || cur;
      const stop = Number(s.stop_price_usd) || 0;
      const target = Number(s.target_price_usd) || 0;
      const sym = `${s.ticker}/USD`;
      const t = technicals[sym];
      const base: CryptoSignal = {
        ...s,
        entry_price_usd: entry,
        stop_price_usd: stop,
        target_price_usd: target,
        stop_pct: Number(s.stop_pct) || 0,
        target_pct: Number(s.target_pct) || 0,
        rsi: t?.rsi ?? null,
        rsi_label: t?.rsiLabel ?? "N/D",
        macd_state: macdState(t),
        bb_position: t?.bb?.position,
        support: t?.sr?.support ?? null,
        resistance: t?.sr?.resistance ?? null,
      };
      return validateCryptoSignal(base);
    });

    const result = { market: snap.market, signals: parsed.signals };

    // Guardar en cache
    if (data.user_id) {
      await setCachedAnalysis(data.user_id, "crypto", result);
    }

    return result;
  });

export const getCryptoBars = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      symbol: z.string().min(1).max(20),
      timeframe: z.enum(["1Hour", "4Hour", "1Day", "1Week"]).default("1Hour"),
      limit: z.number().int().min(1).max(500).default(48),
    }),
  )
  .handler(async ({ data }): Promise<{ bars: ChartBar[] }> => {
    const bars = await getCryptoChartBars(data.symbol, data.timeframe, data.limit);
    return { bars };
  });
