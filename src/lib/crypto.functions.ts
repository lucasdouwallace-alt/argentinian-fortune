import { createServerFn } from "@tanstack/react-start";
import { ORACULO_SYSTEM_PROMPT } from "@/lib/oraculoPrompt";

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
  "BNB/USD",
  "XRP/USD",
  "ADA/USD",
  "AVAX/USD",
  "DOGE/USD",
  "LINK/USD",
  "DOT/USD",
];

export const CRYPTO_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  BNB: "BNB",
  XRP: "XRP",
  ADA: "Cardano",
  AVAX: "Avalanche",
  DOGE: "Dogecoin",
  LINK: "Chainlink",
  DOT: "Polkadot",
};

export type CryptoQuote = {
  ticker: string; // "BTC"
  symbol: string; // "BTC/USD"
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
};

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

export const getCryptoSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<CryptoSnapshot> => {
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
    return {
      market: { fear_greed: fg, btc_dominance: dom, generated_at: ts },
      quotes: out,
    };
  },
);

export const analyzeCrypto = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ market: CryptoMarket; signals: CryptoSignal[] }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY no configurada");
    const snap = await (async () => {
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
        return { ticker, symbol: sym, name: CRYPTO_NAMES[ticker] || ticker, price_usd: price, change_24h_pct: change, volume_24h: b?.v || 0, ts };
      });
      return { market: { fear_greed: fg, btc_dominance: dom, generated_at: ts }, quotes: out };
    })();

    const lines = snap.quotes
      .filter((q) => q.price_usd > 0)
      .map((q) => `${q.ticker}: $${q.price_usd.toLocaleString("en-US", { maximumFractionDigits: 2 })} | 24h ${q.change_24h_pct >= 0 ? "+" : ""}${q.change_24h_pct.toFixed(2)}% | vol ${q.volume_24h.toFixed(0)}`)
      .join("\n");

    const fg = snap.market.fear_greed;
    const dom = snap.market.btc_dominance;

    const userPrompt = `Datos actuales para análisis crypto (Alpaca, en vivo):
${lines}

Fear & Greed Index: ${fg ? `${fg.value} (${fg.label})` : "no disponible"}
Dominancia BTC: ${dom != null ? dom.toFixed(2) + "%" : "no disponible"}
Hora UTC: ${new Date().toISOString()}

Para cada crypto con precio > 0 generá la señal de trading. Respondé SOLO JSON sin texto extra ni backticks:
{
  "signals": [
    {
      "ticker": "BTC",
      "signal": "COMPRAR|VENDER|ESPERAR",
      "entry_price_usd": número exacto (precio actual o nivel de entrada),
      "stop_price_usd": número exacto en USD,
      "target_price_usd": número exacto en USD,
      "stop_pct": número (negativo, ej: -5.5),
      "target_pct": número (positivo, ej: 12.3),
      "horizon": "ej: 2-4 horas | 1-3 días | 1-2 semanas",
      "probability_pct": 60-90,
      "reason": "máximo 15 palabras, razón técnica concreta"
    }
  ]
}

Reglas:
- Generá señales para TODAS las cryptos con precio > 0.
- Los precios stop/target son EXACTOS en USD (no porcentajes).
- stop_pct y target_pct son referencia calculada vs entry.
- Si la señal es ESPERAR, entry_price_usd = nivel de entrada sugerido (puede diferir del actual).`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0.1,
        messages: [
          { role: "system", content: ORACULO_SYSTEM_PROMPT + "\n\nIMPORTANTE: para esta llamada respondé SOLO JSON válido, sin formato visual." },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (r.status === 429) throw new Error("Límite de requests alcanzado.");
    if (r.status === 402) throw new Error("Sin créditos en Lovable AI.");
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Gemini ${r.status}: ${t}`);
    }
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
      const stop = Number(s.stop_price_usd) || (entry > 0 ? +(entry * 0.93).toFixed(2) : 0);
      const target = Number(s.target_price_usd) || (entry > 0 ? +(entry * 1.15).toFixed(2) : 0);
      const stopPct = entry > 0 ? ((stop - entry) / entry) * 100 : 0;
      const targetPct = entry > 0 ? ((target - entry) / entry) * 100 : 0;
      return {
        ...s,
        entry_price_usd: entry,
        stop_price_usd: stop,
        target_price_usd: target,
        stop_pct: Number(s.stop_pct) || +stopPct.toFixed(2),
        target_pct: Number(s.target_pct) || +targetPct.toFixed(2),
      };
    });
    return { market: snap.market, signals: parsed.signals };
  },
);
