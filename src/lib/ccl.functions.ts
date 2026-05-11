import { createServerFn } from "@tanstack/react-start";

export type CclResult = {
  ok: boolean;
  value: number;          // 0 si no se pudo
  source: "ccl" | "mep" | "none";
  fetched_at: string;     // ISO
};

const CCL_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoConLiqui";
const MEP_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/mep";

async function fetchVenta(url: string, timeoutMs = 5000): Promise<number> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return 0;
    const arr = (await r.json()) as Array<{ venta?: number }>;
    return Number(arr?.[arr.length - 1]?.venta) || 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(t);
  }
}

// Server fn: intenta CCL primero, MEP como fallback. Nunca lanza.
export const getCcl = createServerFn({ method: "GET" }).handler(async (): Promise<CclResult> => {
  const ts = new Date().toISOString();
  const ccl = await fetchVenta(CCL_URL);
  if (ccl > 0) return { ok: true, value: ccl, source: "ccl", fetched_at: ts };
  const mep = await fetchVenta(MEP_URL);
  if (mep > 0) return { ok: true, value: mep, source: "mep", fetched_at: ts };
  return { ok: false, value: 0, source: "none", fetched_at: ts };
});
