import { createServerFn } from "@tanstack/react-start";

export type CclResult = {
  ok: boolean;
  value: number;          // 0 si no se pudo
  source: "ccl" | "mep" | "none";
  fetched_at: string;     // ISO
  duration_ms: number;
  attempts: Array<{ source: "ccl" | "mep"; ok: boolean; duration_ms: number; status?: number; error?: string }>;
};

const CCL_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoConLiqui";
const MEP_URL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/mep";

type Attempt = { source: "ccl" | "mep"; ok: boolean; duration_ms: number; status?: number; error?: string };

async function fetchVenta(url: string, source: "ccl" | "mep", timeoutMs = 5000): Promise<{ value: number; attempt: Attempt }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const duration_ms = Date.now() - start;
    if (!r.ok) {
      return { value: 0, attempt: { source, ok: false, duration_ms, status: r.status, error: `HTTP ${r.status}` } };
    }
    const arr = (await r.json()) as Array<{ venta?: number }>;
    const value = Number(arr?.[arr.length - 1]?.venta) || 0;
    return { value, attempt: { source, ok: value > 0, duration_ms, status: r.status, error: value > 0 ? undefined : "empty venta" } };
  } catch (e) {
    const duration_ms = Date.now() - start;
    return { value: 0, attempt: { source, ok: false, duration_ms, error: e instanceof Error ? e.message : String(e) } };
  } finally {
    clearTimeout(t);
  }
}

// Reusable implementation (also exported for unit tests).
export async function fetchCclResult(): Promise<CclResult> {
  const ts = new Date().toISOString();
  const startAll = Date.now();
  const attempts: Attempt[] = [];

  const ccl = await fetchVenta(CCL_URL, "ccl");
  attempts.push(ccl.attempt);
  if (ccl.value > 0) {
    return { ok: true, value: ccl.value, source: "ccl", fetched_at: ts, duration_ms: Date.now() - startAll, attempts };
  }
  const mep = await fetchVenta(MEP_URL, "mep");
  attempts.push(mep.attempt);
  if (mep.value > 0) {
    return { ok: true, value: mep.value, source: "mep", fetched_at: ts, duration_ms: Date.now() - startAll, attempts };
  }
  return { ok: false, value: 0, source: "none", fetched_at: ts, duration_ms: Date.now() - startAll, attempts };
}

// Server fn: intenta CCL primero, MEP como fallback. Nunca lanza.
export const getCcl = createServerFn({ method: "GET" }).handler(async (): Promise<CclResult> => {
  return fetchCclResult();
});
