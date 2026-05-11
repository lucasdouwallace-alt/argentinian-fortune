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
  horizon_days: number;
  risk_level: "Bajo" | "Medio" | "Alto";
  action_reason: string;
  risk_note: string;
  // Niveles porcentuales (acciones/CEDEARs): el usuario aplica al precio de Balanz
  stop_loss_pct: number;   // positivo, ej: 8 → -8%
  take_profit_pct: number; // positivo, ej: 18 → +18%
  entry_offset_pct: number; // 0 si COMPRAR ya; negativo si ESPERAR pullback; positivo si breakout
  // Precios concretos legacy (referencia NYSE; UI muestra %)
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

Para cada activo dame la orden con PORCENTAJES (no precios USD exactos: el usuario opera CEDEARs en BYMA cuyo precio difiere de NYSE).
- Solo activos con probability_pct > 60.
- Ordenados de MAYOR a MENOR probability_pct.
- Máximo 10 activos.
- stop_loss_pct y take_profit_pct son siempre POSITIVOS (la dirección la define el campo signal).
- horizon_days entre 3 y 10 (apuntá a ~5 días, una semana).
- Para COMPRAR: entry_offset_pct = 0.
- Para ESPERAR: entry_offset_pct = % desde precio actual al que conviene entrar (negativo si esperás pullback, positivo si breakout).

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
      "estimated_return_pct": número,
      "horizon":"ej: 5 días hábiles",
      "horizon_days": 5,
      "risk_level":"Bajo|Medio|Alto",
      "stop_loss_pct": número positivo (ej 8 = -8%),
      "take_profit_pct": número positivo (ej 18 = +18%),
      "entry_offset_pct": número (0 si COMPRAR ya, negativo si esperás pullback),
      "entry_price_usd": número (precio NYSE de referencia, opcional),
      "stop_price_usd": 0,
      "target_price_usd": 0,
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
      // Defaults defensivos.
      parsed.assets = (parsed.assets || []).map((a) => {
        const px = Number(a.entry_price_usd) || 0;
        const sl = Number(a.stop_loss_pct) || 8;
        const tp = Number(a.take_profit_pct) || 15;
        const offset = Number(a.entry_offset_pct) || 0;
        const days = Number(a.horizon_days) || 5;
        return {
          ...a,
          stop_loss_pct: Math.abs(sl),
          take_profit_pct: Math.abs(tp),
          entry_offset_pct: offset,
          horizon_days: days,
          horizon: a.horizon || `${days} días hábiles`,
          entry_price_usd: px,
          stop_price_usd: Number(a.stop_price_usd) || (px ? +(px * (1 - Math.abs(sl) / 100)).toFixed(2) : 0),
          target_price_usd: Number(a.target_price_usd) || (px ? +(px * (1 + Math.abs(tp) / 100)).toFixed(2) : 0),
        };
      });
      parsed.assets.sort((a, b) => (b.probability_pct || 0) - (a.probability_pct || 0));
      return parsed;
    } catch {
      console.error("parse failed", text);
      throw new Error("La IA devolvió un formato inválido");
    }
  });
