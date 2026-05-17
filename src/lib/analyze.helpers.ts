import type { TdIndicators } from "./twelvedata.server";
import type { FinnhubSentiment } from "./finnhub.server";

export function macdState(td?: TdIndicators | null): "alcista" | "bajista" | "neutro" {
  const m = td?.macd;
  if (!m) return "neutro";
  if (m.crossUp) return "alcista";
  if (m.crossDown) return "bajista";
  return m.macd_hist > 0 ? "alcista" : m.macd_hist < 0 ? "bajista" : "neutro";
}

export function countConditionsBuy(
  td?: TdIndicators | null,
  sent?: FinnhubSentiment | null,
  bbPos?: string | null
): number {
  let count = 0;
  if (td?.rsi?.rsi != null && td.rsi.rsi < 35) count++;
  if (td?.macd?.crossUp) count++;
  if (bbPos === "lower") count++;
  if (td?.stoch?.slow_k != null && td.stoch.slow_k < 25) count++;
  if (sent?.bullishPercent != null && sent.bullishPercent > 60) count++;
  return count;
}

export function countConditionsSell(
  td?: TdIndicators | null,
  bbPos?: string | null
): number {
  let count = 0;
  if (td?.rsi?.rsi != null && td.rsi.rsi > 68) count++;
  if (td?.macd?.crossDown) count++;
  if (bbPos === "upper") count++;
  if (td?.stoch?.slow_k != null && td.stoch.slow_k > 75) count++;
  return count;
}

export function missingIndicators(td?: TdIndicators | null): string[] {
  const missing: string[] = [];
  if (!td?.rsi) missing.push("RSI");
  if (!td?.macd) missing.push("MACD");
  if (!td?.bbands) missing.push("BB");
  if (!td?.stoch) missing.push("Stoch");
  return missing;
}
