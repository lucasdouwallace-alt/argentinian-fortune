import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  capital_ars: z.number().min(0),
  mep: z.number(),
  ccl: z.number(),
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
  action_reason: string;
  horizon: string;
  risk_note: string;
};

export type MarketAnalysis = {
  market_context: string;
  market_score: number;
  market_score_label: string;
  estimated_monthly_return_pct: number;
  assets: AssetSignal[];
};

export const analyzeMarket = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<MarketAnalysis> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY no configurada");

    const prompt = `Sos un analista financiero experto en mercados de USA y acciones argentinas (ADRs).

PRECIOS EN TIEMPO REAL (Alpaca):
${data.quotes.map(q => `${q.ticker}: USD ${q.price_usd.toFixed(2)} (${q.change_pct.toFixed(2)}% día)`).join("\n")}

CONTEXTO INVERSOR:
- Capital mensual: ARS ${data.capital_ars.toLocaleString("es-AR")} (~USD ${(data.capital_ars / (data.mep || 1)).toFixed(0)})
- MEP: $${data.mep} | CCL: $${data.ccl}
- Posiciones: ${data.positions.length === 0 ? "ninguna abierta" : data.positions.map(p => `${p.ticker} entry $${p.entry_price_usd} pnl ${p.pnl_pct.toFixed(2)}%`).join("; ")}

Analizá el contexto macro de hoy y generá señales concretas. Respondé SOLO JSON válido sin texto extra ni backticks:
{
  "market_context": "2-3 oraciones sobre el mercado hoy",
  "market_score": 0-100,
  "market_score_label": "ej: Favorable",
  "estimated_monthly_return_pct": número,
  "assets": [
    {"ticker":"NVDA","signal":"COMPRAR|VENDER|MANTENER|ESPERAR","confidence":45-92,"action_reason":"1 oración directa","horizon":"corto/medio/largo","risk_note":"breve"}
  ]
}`;

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Sos un analista financiero. Respondé SOLO JSON válido." },
          { role: "user", content: prompt },
        ],
      }),
    });

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
    try {
      return JSON.parse(text) as MarketAnalysis;
    } catch (e) {
      console.error("parse failed", text);
      throw new Error("La IA devolvió un formato inválido");
    }
  });
