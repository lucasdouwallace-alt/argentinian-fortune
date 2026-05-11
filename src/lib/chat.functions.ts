import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-client-middleware";

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(8000),
});

const inputSchema = z.object({
  messages: z.array(messageSchema).min(1).max(40),
  context: z
    .object({
      mep: z.number().nullable().optional(),
      ccl: z.number().nullable().optional(),
      quotes: z
        .array(
          z.object({
            ticker: z.string(),
            price_usd: z.number(),
            change_pct: z.number(),
          })
        )
        .optional(),
    })
    .optional(),
});

export const chatWithOraculo = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof inputSchema>) => inputSchema.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY no configurada");

    const ctxLines: string[] = [];
    if (data.context?.mep) ctxLines.push(`MEP: $${data.context.mep.toFixed(0)} ARS`);
    if (data.context?.ccl) ctxLines.push(`CCL: $${data.context.ccl.toFixed(0)} ARS`);
    if (data.context?.quotes?.length) {
      ctxLines.push("Precios actuales:");
      for (const q of data.context.quotes) {
        ctxLines.push(`- ${q.ticker}: USD ${q.price_usd.toFixed(2)} (${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(2)}%)`);
      }
    }

    const system = [
      "Sos Oráculo, un asistente experto en inversiones bursátiles para usuarios argentinos.",
      "Respondés en español rioplatense, conciso, claro, con bullets cuando ayuda.",
      "Aclarás siempre que NO es asesoramiento financiero personalizado.",
      "Razonás sobre ADRs argentinos, tech USA, dólar MEP/CCL y riesgo país.",
      ctxLines.length ? "\nContexto de mercado en vivo:\n" + ctxLines.join("\n") : "",
    ].join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: system }, ...data.messages],
      }),
    });

    if (res.status === 429) throw new Error("Límite de requests alcanzado, esperá un momento.");
    if (res.status === 402) throw new Error("Sin créditos en Lovable AI. Recargá en Settings → Workspace → Usage.");
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`AI Gateway ${res.status}: ${t.slice(0, 200)}`);
    }
    const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const reply = j.choices?.[0]?.message?.content?.trim() || "Sin respuesta.";
    return { reply };
  });
