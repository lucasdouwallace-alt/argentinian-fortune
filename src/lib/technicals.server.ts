// Indicadores técnicos via Alpaca (fallback para acciones y crypto)
import type { Technicals } from "./technicals";

const ALPACA_DATA = "https://data.alpaca.markets";

function alpacaHeaders() {
  const k = process.env.ALPACA_API_KEY;
  const s = process.env.ALPACA_SECRET_KEY;
  if (!k || !s) throw new Error("Alpaca keys no configuradas");
  return { "APCA-API-KEY-ID": k, "APCA-API-SECRET-KEY": s };
}

export type ChartBar = {
  t: string; o: number; h: number; l: number; c: number; v: number;
};

export type CryptoTechnicals = {
  rsi: number | null;
  rsiLabel: "SOBREVENDIDO" | "NEUTRO" | "SOBRECOMPRADO" | "N/D";
  macd: { macd: number; signal: number; histogram: number; crossover: boolean; crossunder: boolean } | null;
  bb: { upper: number; middle: number; lower: number; position: "upper" | "middle" | "lower" } | null;
  sr: { support: number; resistance: number } | null;
  relativeVolume: number;
};

function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
  const avgGain = gains.slice(-period).reduce((a, b) => a + b) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - 100 / (1 + rs));
}

function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

async function fetchBars(symbol: string, timeframe: string, limit: number): Promise<ChartBar[]> {
  try {
    const isCrypto = symbol.includes("/");
    const base = isCrypto
      ? `${ALPACA_DATA}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`
      : `${ALPACA_DATA}/v2/stocks/bars?symbols=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`;
    const r = await fetch(base, { headers: alpacaHeaders() });
    if (!r.ok) return [];
    const j = await r.json() as { bars: Record<string, Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>> };
    const bars = j.bars?.[symbol] || [];
    return bars.map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
  } catch {
    return [];
  }
}

async function computeTechnicals(symbol: string): Promise<Technicals> {
  const bars = await fetchBars(symbol, "1Day", 30);
  const closes = bars.map(b => b.c);
  const volumes = bars.map(b => b.v);
  const rsi = calcRSI(closes);
  const ma20 = closes.length >= 20
    ? closes.slice(-20).reduce((a, b) => a + b) / 20
    : closes.reduce((a, b) => a + b, 0) / (closes.length || 1);
  const currentPrice = closes[closes.length - 1] || 0;
  const aboveMA20 = currentPrice > ma20;
  const avgVol = volumes.length > 0 ? volumes.reduce((a, b) => a + b) / volumes.length : 1;
  const lastVol = volumes[volumes.length - 1] || 0;
  const relativeVolume = avgVol > 0 ? lastVol / avgVol : 1;
  const volumeLabel: "alto" | "normal" | "bajo" = relativeVolume > 1.5 ? "alto" : relativeVolume < 0.7 ? "bajo" : "normal";
  const change5dPct = closes.length >= 6
    ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
    : null;
  return { rsi, ma20, aboveMA20, relativeVolume, volumeLabel, change5dPct };
}

export async function getTechnicalsBatch(tickers: string[]): Promise<Record<string, Technicals>> {
  const results = await Promise.allSettled(
    tickers.map(async t => [t, await computeTechnicals(t)] as const)
  );
  const out: Record<string, Technicals> = {};
  for (const r of results) {
    if (r.status === "fulfilled") out[r.value[0]] = r.value[1];
  }
  return out;
}

async function computeCryptoTechnicals(symbol: string): Promise<CryptoTechnicals> {
  const bars = await fetchBars(symbol, "1Hour", 50);
  const closes = bars.map(b => b.c);
  const volumes = bars.map(b => b.v);
  const rsi = calcRSI(closes);
  const rsiLabel: CryptoTechnicals["rsiLabel"] = rsi == null ? "N/D" : rsi < 30 ? "SOBREVENDIDO" : rsi > 70 ? "SOBRECOMPRADO" : "NEUTRO";
  let macd: CryptoTechnicals["macd"] = null;
  if (closes.length >= 35) {
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = calcEMA(macdLine.slice(-9), 9);
    const last = macdLine[macdLine.length - 1];
    const sig = signalLine[signalLine.length - 1];
    const prev = macdLine[macdLine.length - 2];
    const prevSig = signalLine[signalLine.length - 2] ?? sig;
    macd = {
      macd: last, signal: sig, histogram: last - sig,
      crossover: prev < prevSig && last > sig,
      crossunder: prev > prevSig && last < sig,
    };
  }
  let bb: CryptoTechnicals["bb"] = null;
  if (closes.length >= 20) {
    const slice = closes.slice(-20);
    const mean = slice.reduce((a, b) => a + b) / 20;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / 20);
    const upper = mean + 2 * std;
    const lower = mean - 2 * std;
    const last = closes[closes.length - 1];
    const position: "upper" | "middle" | "lower" = last >= upper * 0.98 ? "upper" : last <= lower * 1.02 ? "lower" : "middle";
    bb = { upper, middle: mean, lower, position };
  }
  const sr = bars.length >= 20 ? {
    support: Math.min(...bars.slice(-20).map(b => b.l)),
    resistance: Math.max(...bars.slice(-20).map(b => b.h)),
  } : null;
  const avgVol = volumes.length > 0 ? volumes.reduce((a, b) => a + b) / volumes.length : 1;
  const lastVol = volumes[volumes.length - 1] || 0;
  return { rsi, rsiLabel, macd, bb, sr, relativeVolume: avgVol > 0 ? lastVol / avgVol : 1 };
}

export async function getCryptoTechnicalsBatch(symbols: string[]): Promise<Record<string, CryptoTechnicals>> {
  const results = await Promise.allSettled(
    symbols.map(async s => [s, await computeCryptoTechnicals(s)] as const)
  );
  const out: Record<string, CryptoTechnicals> = {};
  for (const r of results) {
    if (r.status === "fulfilled") out[r.value[0]] = r.value[1];
  }
  return out;
}

export async function getCryptoChartBars(symbol: string, timeframe: string, limit: number): Promise<ChartBar[]> {
  return fetchBars(symbol, timeframe, limit);
}
