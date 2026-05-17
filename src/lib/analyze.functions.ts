import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ORACULO_SYSTEM_PROMPT } from "@/lib/oraculoPrompt";
import { getTechnicalsBatch } from "@/lib/technicals.server";
import { capsForTicker, type Technicals } from "@/lib/technicals";
import { getTdIndicators, bbandsPosition, type TdIndicators } from "@/lib/twelvedata.server";
import { getNews, getSentiment, type FinnhubNews, type FinnhubSentiment } from "@/lib/finnhub.server";
import { validateSignal } from "@/lib/signalValidator";
import { macdState, countConditionsBuy, countConditionsSell, missingIndicators } from "@/lib/analyze.helpers";
import { captureAnalysisIssue } from "@/lib/monitoring";
import { queueGeminiCall } from "@/lib/geminiQueue";
import { getCachedAnalysis, setCachedAnalysis } from "@/lib/analysisCache";

const InputSchema = z.object({
  capital_ars: z.number().min(0),
  mep: z.number(),
  ccl: z.number(),
  market_open: z.boolean().optional().default(true),
  force: z.boolean().optional().default(false),
  user_id: z.string().optional(),
  quotes: z.array(z.object({
    ticker: z.string(),
    price_usd: z.number(),
    change_pct: z.number(),
  })),
  positions: z.array(z.object({
    ticker: z.string(),
    entry_price_usd: z.number(),
    pnl_pct: z.number(),
  })).optional().default([]),
});

export type AssetSignal = {
  ticker: string;
  signal: "COMPRAR" | "VENDER" | "MANTENER" | "ESPERAR";
  confidence: number;
  probability_pct: number;
  estimated_return_pct: number;
  horizon: string;
  horizon_days: number;
  risk_level: "Bajo" | "Medio" | "Alto";
  action_reason: string;
  risk_note: string;
  stop_loss_pct: number;
  take_profit_pct: number;
  entry_offset_pct: number;
  entry_price_usd: number;
  stop_price_usd: number;
  target_price_usd: number;
  rsi?: number | null;
  rsi_label?: "SOBREVENDIDO" | "NEUTRO" | "SOBRECOMPRADO" | "N/D";
  macd_state?: "alcista" | "bajista" | "neutro";
  bb_position?: "upper" | "middle" | "lower";
  stoch_state?: "oversold" | "neutral" | "overbought";
  stoch_k?: number | null;
  conditions_met?: number;
  key_indicator?: string;
  bullish_pct?: number;
  bearish_pct?: number;
  news_headlines?: string[];
  volume_label?: "alto" | "normal" | "bajo";
  above_ma20?: boolean;
  ma20?: number;
  relative_volume?: number;
  change5d_pct?: number | null;
  technicals_partial?: boolean;
  target_adjusted?: boolean;
  data_insufficient?: boolean;
};

export type MarketAnalysis = {
  market_context: string;
  market_score: number;
  market_score_label: string;
  estimated_monthly_return_pct: number;
  assets: AssetSignal[];
  generated_at: string;
  cache_age_min?: number;
};

export const analyzeMarket = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<MarketAnalysis> => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY no configurada");

    // Cache: si no es force refresh, devolver análisis reciente
    if (!data.force && data.user_id) {
      const cached = await getCachedAnalysis<MarketAnalysis>(data.user_id, "market");
      if (cached) {
        const minutes = Math.round(cached.age_ms / 60_000);
        console.log(`[analyze] cache hit (${minutes} min old)`);
        return { ...cached.data, cache_age_min: minutes };
      }
    }

    const tickers = data.quotes.map((q) => q.ticker);

    const [tdMap, newsMap, sentMap, alpacaTech] = await Promise.all([
      Promise.all(tickers.map(async (t) => [t, await getTdIndicators(t)] as const))
        .then((arr) => Object.fromEntries(arr) as Record<string, TdIndicators>),
      Promise.all(tickers.map(async (t) => [t, await getNews(t)] as const))
        .then((arr) => Object.fromEntries(arr) as Record<string, FinnhubNews[]>),
      Promise.all(tickers.map(async (t) => [t, await getSentiment(t)] as const))
        .then((arr) => Object.fromEntries(arr) as Record<string, FinnhubSentiment | null>),
      getTechnicalsBatch(tickers).catch(() => ({} as Record<string, Technicals>)),
    ]);

    for (const t of tickers) {
      const missing = missingIndicators(tdMap[t]);
      if (missing.length > 0) {
        captureAnalysisIssue({ ticker: t, missing, stage: "fetch" });
      }
    }

    const lines = data.quotes.map((q) => {
      const td = tdMap[q.ticker];
      const sent = sentMap[q.ticker];
      const news = newsMap[q.ticker] || [];
      const caps = capsForTicker(q.ticker);
      const bb = td?.bbands ? bbandsPosition(td.bbands, q.price_usd) : null;
      const cBuy = countConditionsBuy(td, sent, bb?.position ?? null);
      const cSell = countConditionsSell(td, bb?.position ?? null);
      const ms = macdState(td);
      const headlines = news.slice(0, 2).map((n) => n.headline.slice(0, 80)).join(" | ") || "sin noticias";
      return `${q.ticker} [${caps.categoryLabel} $${q.price_usd.toFixed(2)} (${q.change_pct.toFixed(2)}%) `
        + `| RSI ${td?.rsi?.rsi ?? "N/D"} | MACD ${ms}${td?.macd ? ` (${td.macd.macd.toFixed(3)}/${td.macd.macd_signal.toFixed(3)})` : ""} `
        + `| BB ${bb?.position ?? "N/D"}${bb ? ` (lo ${bb.lower_band.toFixed(2)}/up ${bb.upper_band.toFixed(2)})` : ""} `
        + `| Stoch K ${td?.stoch?.slow_k.toFixed(1) ?? "N/D"} (${td?.stoch?.state ?? "N/D"}) `
        + `| Sent bull ${sent?.bullishPercent ?? "N/D"}% / bear ${sent?.bearishPercent ?? "N/D"}% `
        + `| Cond buy ${cBuy}/5 sell ${cSell}/4 `
        + `| News: ${headlines}`;
    }).join("\n");

    const prompt = `Análisis cuantitativo profesional con datos REALES.
Cada activo trae RSI(14), MACD(12,26,9), BB(20,2), Stochastic — todos pre-calculados por Twelve Data.
Sentiment y noticias de Finnhub.

${lines}

CCL: $${data.ccl} | MEP: $${data.mep} | Mercado: ${data.market_open ? "abierto" : "cerrado"}
Capital usuario: ARS ${data.capital_ars.toLocaleString("es-AR")}
Posiciones abiertas: ${data.positions.length === 0 ? "ninguna" : data.positions.map(p => `${p.ticker} pnl ${p.pnl_pct.toFixed(2)}%`).join("; ")}

REGLAS ESTRICTAS:
- COMPRAR requiere ≥3 condiciones cumplidas (ver "Cond buy" arriba).
- VENDER requiere ≥2 condiciones de venta cumplidas.
- ESPERAR cuando no hay setup claro. No fuerces señales débiles.
- Probabilidad honesta: 5 cond=85-92%, 4=75-84%, 3=62-74%, 2=50-61%.
- stop_loss_pct y take_profit_pct positivos (la dirección la define signal), calculalos LIBREMENTE según el setup real. Sin caps. Si el momentum justifica +20%, poné +20%.
- Mínimo 2-3 activos COMPRAR/VENDER. Ordenados por probability_pct desc.
- En "reason" mencioná los indicadores reales y cuántas condiciones se cumplieron.

Respondé SOLO JSON válido sin texto extra ni backticks:
{
  "market_context": "2-3 oraciones",
  "market_score": 0-100,
  "market_score_label": "ej: Favorable",
  "estimated_monthly_return_pct": número,
  "assets": [
    {
      "ticker": "NVDA",
      "signal": "COMPRAR|VENDER|ESPERAR",
      "confidence": 50-92,
      "probability_pct": 50-92,
      "estimated_return_pct": número,
      "horizon": "plazo real según momentum (ej: 8 días, 15 días, 3 semanas)",
      "horizon_days": número real según momentum (no siempre 5),
      "risk_level": "Bajo|Medio|Alto",
      "stop_loss_pct": número positivo (≤ SLmax),
      "take_profit_pct": número positivo (≤ TPmax),
      "entry_offset_pct": 0,
      "entry_price_usd": precio referencia,
      "stop_price_usd": 0,
      "target_price_usd": 0,
      "conditions_met": 0-5,
      "key_indicator": "el más determinante",
      "action_reason": "15 palabras citando indicadores reales",
      "risk_note": "breve"
    }
  ]
}`;

    const callGemini = () => queueGeminiCall(() => fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
        messages: [
          { role: "system", content: ORACULO_SYSTEM_PROMPT + "\n\nIMPORTANTE: para esta llamada respondé SOLO JSON válido (sin el formato visual ⚡), siguiendo el schema pedido." },
          { role: "user", content: prompt },
        ],
      }),
    }));

    // Reintentos con backoff exponencial ante 429
    let r = await callGemini();
    const delays = [3000, 7000, 15000];
    for (const d of delays) {
      if (r.status !== 429) break;
      await new Promise((res) => setTimeout(res, d));
      r = await callGemini();
    }

    // Si después de los reintentos sigue fallando, devolvemos fallback (no crash)
    if (r.status === 429 || r.status === 402 || !r.ok) {
      const reason = r.status === 429
        ? "Gemini saturado (free tier). Reintentá en ~60s."
        : r.status === 402
          ? "Sin créditos en Groq."
          : `Gemini ${r.status}`;
      console.error("[analyze] fallback:", reason);
      return {
        market_context: `Análisis IA no disponible: ${reason} Mostrando indicadores técnicos sin recomendación.`,
        market_score: 50,
        market_score_label: "Sin datos IA",
        estimated_monthly_return_pct: 0,
        assets: data.quotes.map((q) => buildInsufficientSignal(q.ticker, q.price_usd)),
        generated_at: new Date().toISOString(),
      };
    }


    const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
    let text = j.choices[0]?.message?.content || "{}";
    text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) text = text.slice(start, end + 1);

    let parsed: MarketAnalysis;
    try {
      parsed = JSON.parse(text) as MarketAnalysis;
    } catch {
      console.error("[analyze] parse failed", text);
      throw new Error("La IA devolvió un formato inválido");
    }

    parsed.assets = (parsed.assets || []).map((a) => {
      const td = tdMap[a.ticker];
      const sent = sentMap[a.ticker];
      const news = newsMap[a.ticker] || [];
      const tech = alpacaTech[a.ticker];
      const bb = td?.bbands ? bbandsPosition(td.bbands, a.entry_price_usd || 0) : null;
      const validated: { signal: AssetSignal["signal"]; probability_pct: number; stop_loss_pct: number; take_profit_pct: number; target_adjusted?: boolean } = validateSignal({
        signal: a.signal,
        probability_pct: Number(a.probability_pct) || 50,
        stop_loss_pct: Number(a.stop_loss_pct) || 5,
        take_profit_pct: Number(a.take_profit_pct) || 5,
        target_adjusted: false,
      }, a.ticker);
      const px = Number(a.entry_price_usd) || 0;
      const sl = validated.stop_loss_pct;
      const tp = validated.take_profit_pct;
      const cBuy = countConditionsBuy(td, sent, bb?.position ?? null);
      const cSell = countConditionsSell(td, bb?.position ?? null);
      return {
        ...a,
        stop_loss_pct: sl,
        take_profit_pct: tp,
        target_adjusted: validated.target_adjusted,
        entry_offset_pct: Number(a.entry_offset_pct) || 0,
        horizon_days: Number(a.horizon_days) || 5,
        horizon: a.horizon || `${Number(a.horizon_days) || 5} días hábiles`,
        entry_price_usd: px,
        stop_price_usd: Number(a.stop_price_usd) || (px ? +(px * (1 - sl / 100)).toFixed(2) : 0),
        target_price_usd: Number(a.target_price_usd) || (px ? +(px * (1 + tp / 100)).toFixed(2) : 0),
        rsi: td?.rsi?.rsi ?? null,
        rsi_label: td?.rsi
          ? (td.rsi.rsi > 70 ? "SOBRECOMPRADO" : td.rsi.rsi < 30 ? "SOBREVENDIDO" : "NEUTRO")
          : "N/D",
        macd_state: macdState(td),
        bb_position: bb?.position,
        stoch_state: td?.stoch?.state,
        stoch_k: td?.stoch?.slow_k ?? null,
        conditions_met: a.signal === "VENDER" ? cSell : cBuy,
        bullish_pct: sent?.bullishPercent,
        bearish_pct: sent?.bearishPercent,
        news_headlines: news.slice(0, 3).map((n) => n.headline),
        volume_label: tech?.volumeLabel,
        above_ma20: tech?.aboveMA20,
        ma20: tech?.ma20,
        relative_volume: tech?.relativeVolume,
        change5d_pct: tech?.change5dPct ?? null,
        technicals_partial: !td?.rsi,
      };
    });

    parsed.assets.sort((a, b) => (b.probability_pct || 0) - (a.probability_pct || 0));
    parsed.assets = enforceSignalDistribution(parsed.assets);
    parsed.generated_at = new Date().toISOString();

    // Guardar en cache
    if (data.user_id) {
      await setCachedAnalysis(data.user_id, "market", parsed);
    }

    return parsed;
  });

export function enforceSignalDistribution(assets: AssetSignal[]): AssetSignal[] {
  if (!assets.length) return assets;
  return [...assets].sort((a, b) => (b.probability_pct || 0) - (a.probability_pct || 0));
}

export function partitionByTechnicals<Q extends { ticker: string }>(
  quotes: Q[],
  technicals: Record<string, { rsi: number | null } | undefined>,
): { sufficient: Q[]; insufficient: Q[] } {
  const sufficient: Q[] = [];
  const insufficient: Q[] = [];
  for (const q of quotes) {
    const t = technicals[q.ticker];
    if (t && t.rsi != null) sufficient.push(q);
    else insufficient.push(q);
  }
  return { sufficient, insufficient };
}

export function buildInsufficientSignal(ticker: string, price_usd: number): AssetSignal {
  const caps = capsForTicker(ticker);
  return {
    ticker,
    signal: "ESPERAR",
    confidence: 50,
    probability_pct: 50,
    estimated_return_pct: 0,
    horizon: "Sin datos",
    horizon_days: 5,
    risk_level: "Medio",
    action_reason: "Sin datos técnicos suficientes para generar una señal honesta.",
    risk_note: "No operes sin indicadores reales.",
    stop_loss_pct: caps.slMax,
    take_profit_pct: caps.tpMax,
    entry_offset_pct: 0,
    entry_price_usd: price_usd,
    stop_price_usd: price_usd ? +(price_usd * (1 - caps.slMax / 100)).toFixed(2) : 0,
    target_price_usd: price_usd ? +(price_usd * (1 + caps.tpMax / 100)).toFixed(2) : 0,
    rsi: null,
    rsi_label: "N/D",
    technicals_partial: true,
    data_insufficient: true,
  };
}
