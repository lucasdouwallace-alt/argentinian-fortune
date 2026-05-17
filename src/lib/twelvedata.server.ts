// Twelve Data: indicadores técnicos pre-calculados
import { cacheGet, cacheSet, CACHE_TTL_MS } from "./marketCache";

const BASE = "https://api.twelvedata.com";

function key() {
  const k = process.env.TWELVE_DATA_API_KEY;
  if (!k) throw new Error("TWELVE_DATA_API_KEY no configurada");
  return k;
}

async function tdFetch<T>(path: string, params: Record<string, string>): Promise<T | null> {
  try {
    const qs = new URLSearchParams({ ...params, apikey: key() });
    const r = await fetch(`${BASE}${path}?${qs.toString()}`);
    if (!r.ok) return null;
    const j = await r.json() as { status?: string; values?: unknown; code?: number };
    if (j.status === "error" || j.code) return null;
    return j as T;
  } catch {
    return null;
  }
}

export type TdRsi = { rsi: number };
export type TdMacd = {
  macd: number; macd_signal: number; macd_hist: number;
  crossUp: boolean; crossDown: boolean;
};
export type TdBBands = {
  upper_band: number; middle_band: number; lower_band: number;
  position: "upper" | "middle" | "lower"; rel: number;
};
export type TdStoch = {
  slow_k: number; slow_d: number;
  state: "oversold" | "neutral" | "overbought";
};
export type TdIndicators = {
  rsi: TdRsi | null;
  macd: TdMacd | null;
  bbands: TdBBands | null;
  stoch: TdStoch | null;
};

async function loadRsi(symbol: string, interval: string): Promise<TdRsi | null> {
  const r = await tdFetch<{ values: Array<{ rsi: string }> }>(
    "/rsi", { symbol, interval, time_period: "14", outputsize: "1" });
  const v = r?.values?.[0];
  if (!v) return null;
  const rsi = Number(v.rsi);
  return Number.isFinite(rsi) ? { rsi: Math.round(rsi) } : null;
}

async function loadMacd(symbol: string, interval: string): Promise<TdMacd | null> {
  const r = await tdFetch<{ values: Array<{ macd: string; macd_signal: string; macd_hist: string }> }>(
    "/macd", { symbol, interval, fast_period: "12", slow_period: "26", signal_period: "9", outputsize: "2" });
  const arr = r?.values;
  if (!arr || arr.length < 1) return null;
  const today = arr[0];
  const macd = Number(today.macd), sig = Number(today.macd_signal), hist = Number(today.macd_hist);
  if (![macd, sig, hist].every(Number.isFinite)) return null;
  let crossUp = false, crossDown = false;
  if (arr.length >= 2) {
    const yMacd = Number(arr[1].macd), ySig = Number(arr[1].macd_signal);
    if (Number.isFinite(yMacd) && Number.isFinite(ySig)) {
      crossUp = yMacd < ySig && macd > sig;
      crossDown = yMacd > ySig && macd < sig;
    }
  }
  return { macd, macd_signal: sig, macd_hist: hist, crossUp, crossDown };
}

async function loadBBands(symbol: string, interval: string): Promise<TdBBands | null> {
  const r = await tdFetch<{ values: Array<{ upper_band: string; middle_band: string; lower_band: string }> }>(
    "/bbands", { symbol, interval, time_period: "20", sd: "2", outputsize: "1" });
  const v = r?.values?.[0];
  if (!v) return null;
  const upper = Number(v.upper_band), middle = Number(v.middle_band), lower = Number(v.lower_band);
  if (![upper, middle, lower].every(Number.isFinite)) return null;
  return { upper_band: upper, middle_band: middle, lower_band: lower, position: "middle", rel: 0.5 };
}

async function loadStoch(symbol: string, interval: string): Promise<TdStoch | null> {
  const r = await tdFetch<{ values: Array<{ slow_k: string; slow_d: string }> }>(
    "/stoch", { symbol, interval, outputsize: "1" });
  const v = r?.values?.[0];
  if (!v) return null;
  const k = Number(v.slow_k), d = Number(v.slow_d);
  if (![k, d].every(Number.isFinite)) return null;
  const state: TdStoch["state"] = k < 20 ? "oversold" : k > 80 ? "overbought" : "neutral";
  return { slow_k: k, slow_d: d, state };
}

export async function getTdIndicators(symbol: string, interval = "1day"): Promise<TdIndicators> {
  const cacheKey = `td:${symbol}:${interval}`;
  const cached_hit = cacheGet<TdIndicators>(cacheKey);
  if (cached_hit !== null) return cached_hit;

  const [rsi, macd, bbands, stoch] = await Promise.all([
    loadRsi(symbol, interval),
    loadMacd(symbol, interval),
    loadBBands(symbol, interval),
    loadStoch(symbol, interval),
  ]);

  const result: TdIndicators = { rsi, macd, bbands, stoch };
  if (rsi !== null || macd !== null || bbands !== null || stoch !== null) {
    cacheSet(cacheKey, result, CACHE_TTL_MS.indicators);
  }
  return result;
}

export function bbandsPosition(bb: TdBBands, lastPrice: number): TdBBands {
  const range = bb.upper_band - bb.lower_band;
  const rel = range > 0 ? (lastPrice - bb.lower_band) / range : 0.5;
  let position: TdBBands["position"];
  if (rel >= 0.8) position = "upper";
  else if (rel <= 0.2) position = "lower";
  else position = "middle";
  return { ...bb, rel: +rel.toFixed(3), position };
}
