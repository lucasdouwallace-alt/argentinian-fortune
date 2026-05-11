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
  probability_pct: number;
  estimated_return_pct: number;
  horizon: string;
  risk_level: "Bajo" | "Medio" | "Alto";
  action_reason: string;
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

    const prompt = `Sos un vidente financiero experto en mercados de USA y acciones argentinas (ADRs/CEDEARs).

PRECIOS EN TIEMPO REAL (Alpaca):
${data.quotes.map(q => `${q.ticker}: USD ${q.price_usd.toFixed(2)} (${q.change_pct.toFixed(2)}% día)`).join("\n")}

CONTEXTO INVERSOR:
- Capital mensual: ARS ${data.capital_ars.toLocaleString("es-AR")} (~USD ${(data.capital_ars / (data.mep || 1)).toFixed(0)})
- MEP: $${data.mep} | CCL: $${data.ccl}
- Posiciones: ${data.positions.length === 0 ? "ninguna abierta" : data.positions.map(p => `${p.ticker} entry $${p.entry_price_usd} pnl ${p.pnl_pct.toFixed(2)}%`).join("; ")}

Analizá el contexto macro de hoy y generá señales concretas para CADA activo.
Para cada activo generá: probabilidad de ganancia entre 45% y 92%, retorno estimado con horizonte temporal, y nivel de riesgo (Bajo/Medio/Alto).
Ordená los assets de MAYOR a MENOR probability_pct.

Respondé SOLO JSON válido sin texto extra ni backticks:
{
  "market_context": "2-3 oraciones sobre el mercado hoy",
  "market_score": 0-100,
  "market_score_label": "ej: Favorable",
  "estimated_monthly_return_pct": número,
  "assets": [
    {
      "ticker":"VIST",
      "signal":"COMPRAR|VENDER|MANTENER|ESPERAR",
      "confidence":45-92,
      "probability_pct":45-92,
      "estimated_return_pct": número (positivo o negativo),
      "horizon":"ej: 2-3 semanas",
      "risk_level":"Bajo|Medio|Alto",
      "action_reason":"1-2 oraciones directas explicando el por qué",
      "risk_note":"breve"
    }
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
      const parsed = JSON.parse(text) as MarketAnalysis;
      // sort by probability desc
      parsed.assets.sort((a, b) => (b.probability_pct || 0) - (a.probability_pct || 0));
      return parsed;
    } catch (e) {
      console.error("parse failed", text);
      throw new Error("La IA devolvió un formato inválido");
    }
  });
