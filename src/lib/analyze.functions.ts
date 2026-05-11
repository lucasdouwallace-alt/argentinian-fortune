import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ORACULO_SYSTEM_PROMPT } from "@/lib/oraculoPrompt";

const InputSchema = z.object({
  capital_ars: z.number().min(0),
  mep: z.number(),
  ccl: z.number(),
  market_open: z.boolean().optional().default(true),
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
  // Precios concretos (orden ejecutable)
  entry_price_usd: number;
  stop_price_usd: number;
  target_price_usd: number;
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

    const prompt = `Analizá estos activos con sus precios reales actuales de Alpaca:
${data.quotes.map(q => `${q.ticker}: USD ${q.price_usd.toFixed(2)} (${q.change_pct.toFixed(2)}% día)`).join("\n")}

CCL actual: $${data.ccl} (ArgentinaDatos) | MEP: $${data.mep}
Estado del mercado: ${data.market_open ? "abierto" : "cerrado"}
Capital del usuario: ARS ${data.capital_ars.toLocaleString("es-AR")} (~USD ${(data.capital_ars / (data.mep || 1)).toFixed(0)})
Posiciones abiertas: ${data.positions.length === 0 ? "ninguna" : data.positions.map(p => `${p.ticker} entry $${p.entry_price_usd} pnl ${p.pnl_pct.toFixed(2)}%`).join("; ")}

Para cada activo dame la orden EXACTA con precios concretos (entry, stop, target en USD).
- Solo incluí activos con probability_pct > 60.
- Ordenados de MAYOR a MENOR probability_pct.
- Máximo 10 activos.

Respondé SOLO JSON válido sin texto extra ni backticks:
{
  "market_context": "2-3 oraciones sobre el mercado hoy",
  "market_score": 0-100,
  "market_score_label": "ej: Favorable",
  "estimated_monthly_return_pct": número,
  "assets": [
    {
      "ticker":"VIST",
      "signal":"COMPRAR|VENDER|ESPERAR",
      "confidence":60-92,
      "probability_pct":60-92,
      "estimated_return_pct": número (positivo o negativo),
      "horizon":"ej: 2-3 semanas",
      "risk_level":"Bajo|Medio|Alto",
      "entry_price_usd": número (precio de entrada exacto en USD),
      "stop_price_usd": número (stop loss exacto en USD),
      "target_price_usd": número (take profit exacto en USD),
      "action_reason":"máximo 15 palabras, una sola razón concreta",
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
        temperature: 0.1,
        messages: [
          { role: "system", content: ORACULO_SYSTEM_PROMPT + "\n\nIMPORTANTE: para esta llamada respondé SOLO JSON válido (sin el formato visual ⚡), siguiendo el schema pedido." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (r.status === 429) throw new Error("Límite de requests alcanzado, esperá un momento.");
    if (r.status === 402) throw new Error("Sin créditos en Lovable AI. Recargá en Settings → Workspace → Usage.");
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
      // Defaults defensivos por si la IA omite algún precio.
      parsed.assets = (parsed.assets || []).map((a) => {
        const px = Number(a.entry_price_usd) || 0;
        return {
          ...a,
          entry_price_usd: px,
          stop_price_usd: Number(a.stop_price_usd) || (px ? +(px * 0.92).toFixed(2) : 0),
          target_price_usd: Number(a.target_price_usd) || (px ? +(px * 1.15).toFixed(2) : 0),
        };
      });
      parsed.assets.sort((a, b) => (b.probability_pct || 0) - (a.probability_pct || 0));
      return parsed;
    } catch {
      console.error("parse failed", text);
      throw new Error("La IA devolvió un formato inválido");
    }
  });
