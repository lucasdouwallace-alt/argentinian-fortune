import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCcl, type CclResult } from "@/lib/ccl.functions";

const STORAGE_KEY = "oraculo:ccl_last";
const POLL_MS = 30_000;

type CachedCcl = {
  value: number;
  source: "ccl" | "mep";
  ts: number; // epoch ms
};

export type CclState = {
  // Valor a usar para cálculos (cache si fresh fetch falla)
  effective: number;
  // Estado del último fetch
  lastResult: CclResult | null;
  // Última cotización conocida (puede ser de cache)
  lastKnown: CachedCcl | null;
  loading: boolean;
  ageMin: number | null;     // edad de lastKnown en minutos
  refresh: () => void;
};

function readCache(): CachedCcl | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (typeof j?.value === "number" && j.value > 0 && typeof j?.ts === "number") {
      return { value: j.value, source: j.source === "mep" ? "mep" : "ccl", ts: j.ts };
    }
  } catch { /* noop */ }
  return null;
}

function writeCache(value: number, source: "ccl" | "mep") {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ value, source, ts: Date.now() }));
  } catch { /* noop */ }
}

export function useCcl(): CclState {
  const fetchCcl = useServerFn(getCcl);
  const [lastResult, setLastResult] = useState<CclResult | null>(null);
  const [lastKnown, setLastKnown] = useState<CachedCcl | null>(() => readCache());
  const [loading, setLoading] = useState(false);
  const [, setNow] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCcl();
      setLastResult(res);
      if (res.ok && res.value > 0 && (res.source === "ccl" || res.source === "mep")) {
        const cached: CachedCcl = { value: res.value, source: res.source, ts: Date.now() };
        writeCache(res.value, res.source);
        setLastKnown(cached);
      }
    } catch {
      // network error: mantener lastResult anterior
    } finally {
      setLoading(false);
    }
  }, [fetchCcl]);

  // Polling cada 30s. Si el último fetch falló, igual reintentamos cada 30s.
  useEffect(() => {
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      await tick();
      if (cancelled) return;
      timerRef.current = setTimeout(loop, POLL_MS);
    };
    loop();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [tick]);

  // Tick por minuto para refrescar "hace X min"
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const ageMin = lastKnown ? Math.max(0, Math.floor((Date.now() - lastKnown.ts) / 60_000)) : null;
  const effective = lastResult?.ok && lastResult.value > 0 ? lastResult.value : (lastKnown?.value ?? 0);

  return { effective, lastResult, lastKnown, loading, ageMin, refresh: tick };
}
