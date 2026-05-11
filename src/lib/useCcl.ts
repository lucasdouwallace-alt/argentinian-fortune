import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCcl, type CclResult } from "@/lib/ccl.functions";
import { captureCclFailure, captureCclSuccess } from "@/lib/monitoring";

const STORAGE_KEY = "oraculo:ccl_last";
const POLL_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000; // 5 min

type CachedCcl = {
  value: number;
  source: "ccl" | "mep";
  ts: number; // epoch ms
};

export type CclState = {
  effective: number;
  lastResult: CclResult | null;
  lastKnown: CachedCcl | null;
  loading: boolean;
  ageMin: number | null;
  consecutiveFailures: number;
  nextPollMs: number;
  refresh: () => Promise<CclResult | null>;
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

// Exponential backoff: 30s, 60s, 120s, 240s, capped at 5min.
export function computeBackoffMs(failures: number): number {
  if (failures <= 0) return POLL_MS;
  const ms = POLL_MS * Math.pow(2, Math.min(failures - 1, 5));
  return Math.min(ms, MAX_BACKOFF_MS);
}

export function useCcl(): CclState {
  const fetchCcl = useServerFn(getCcl);
  const [lastResult, setLastResult] = useState<CclResult | null>(null);
  const [lastKnown, setLastKnown] = useState<CachedCcl | null>(() => readCache());
  const [loading, setLoading] = useState(false);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [, setNow] = useState(Date.now());
  const failuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCcl();
      setLastResult(res);
      if (res.ok && res.value > 0 && (res.source === "ccl" || res.source === "mep")) {
        const recoveredAfter = failuresRef.current;
        failuresRef.current = 0;
        setConsecutiveFailures(0);
        const cached: CachedCcl = { value: res.value, source: res.source, ts: Date.now() };
        writeCache(res.value, res.source);
        setLastKnown(cached);
        captureCclSuccess({ source: res.source, durationMs: res.duration_ms, recoveredAfter });
      } else {
        failuresRef.current += 1;
        setConsecutiveFailures(failuresRef.current);
        captureCclFailure({
          source: res.source,
          durationMs: res.duration_ms,
          consecutiveFailures: failuresRef.current,
          message: res.attempts?.map((a) => `${a.source}:${a.error ?? "ok"}`).join(" | "),
        });
      }
    } catch (e) {
      failuresRef.current += 1;
      setConsecutiveFailures(failuresRef.current);
      captureCclFailure({
        source: "none",
        durationMs: 0,
        consecutiveFailures: failuresRef.current,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [fetchCcl]);

  // Polling con backoff exponencial cuando hay fallos.
  useEffect(() => {
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      await tick();
      if (cancelled) return;
      const delay = computeBackoffMs(failuresRef.current);
      timerRef.current = setTimeout(loop, delay);
    };
    loop();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [tick]);

  // Refresca "hace X min".
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Refresh manual: cancela el timer pendiente y dispara un fetch inmediato.
  const refresh = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await tick();
    timerRef.current = setTimeout(async function next() {
      await tick();
      timerRef.current = setTimeout(next, computeBackoffMs(failuresRef.current));
    }, computeBackoffMs(failuresRef.current));
  }, [tick]);

  const ageMin = lastKnown ? Math.max(0, Math.floor((Date.now() - lastKnown.ts) / 60_000)) : null;
  const effective = lastResult?.ok && lastResult.value > 0 ? lastResult.value : (lastKnown?.value ?? 0);
  const nextPollMs = computeBackoffMs(consecutiveFailures);

  return { effective, lastResult, lastKnown, loading, ageMin, consecutiveFailures, nextPollMs, refresh };
}
