// Finnhub: precios en tiempo real, noticias y sentiment
import { cacheGet, cacheSet, CACHE_TTL_MS } from "./marketCache";

const BASE = "https://finnhub.io/api/v1";

function key() {
  const k = process.env.FINNHUB_API_KEY;
  if (!k) throw new Error("FINNHUB_API_KEY no configurada");
  return k;
}

export type FinnhubQuote = {
  c: number; d: number; dp: number; h: number; l: number; o: number;
};

export type FinnhubNews = {
  headline: string; summary: string; url: string; datetime: number; source: string;
};

export type FinnhubSentiment = {
  bullishPercent: number; bearishPercent: number;
};

async function fhFetch<T>(path: string, params: Record<string, string>): Promise<T | null> {
  try {
    const qs = new URLSearchParams({ ...params, token: key() });
    const r = await fetch(`${BASE}${path}?${qs.toString()}`);
    if (!r.ok) return null;
    return await r.json() as T;
  } catch {
    return null;
  }
}

export async function getQuote(symbol: string): Promise<FinnhubQuote | null> {
  const cacheKey = `fh:quote:${symbol}`;
  const cached = cacheGet<FinnhubQuote>(cacheKey);
  if (cached) return cached;
  const result = await fhFetch<FinnhubQuote>("/quote", { symbol });
  if (result && result.c > 0) {
    cacheSet(cacheKey, result, 30_000); // 30 segundos
  }
  return result;
}

export async function getQuotesBatch(
  symbols: string[]
): Promise<Record<string, FinnhubQuote>> {
  const results = await Promise.allSettled(
    symbols.map(async (s) => [s, await getQuote(s)] as const)
  );
  const out: Record<string, FinnhubQuote> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value[1]) {
      out[r.value[0]] = r.value[1];
    }
  }
  return out;
}

export async function getNews(symbol: string): Promise<FinnhubNews[]> {
  const cacheKey = `fh:news:${symbol}`;
  const cached = cacheGet<FinnhubNews[]>(cacheKey);
  if (cached) return cached;
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const result = await fhFetch<FinnhubNews[]>("/company-news", {
    symbol, from: weekAgo, to: today,
  });
  const news = (result || []).slice(0, 5);
  if (news.length > 0) {
    cacheSet(cacheKey, news, CACHE_TTL_MS.news ?? 3_600_000);
  }
  return news;
}

export async function getSentiment(symbol: string): Promise<FinnhubSentiment | null> {
  const cacheKey = `fh:sent:${symbol}`;
  const cached = cacheGet<FinnhubSentiment>(cacheKey);
  if (cached) return cached;
  const result = await fhFetch<{
    sentiment?: { bullishPercent?: number; bearishPercent?: number };
  }>("/news-sentiment", { symbol });
  if (!result?.sentiment) return null;
  const sent: FinnhubSentiment = {
    bullishPercent: result.sentiment.bullishPercent ?? 50,
    bearishPercent: result.sentiment.bearishPercent ?? 50,
  };
  cacheSet(cacheKey, sent, CACHE_TTL_MS.sentiment ?? 3_600_000);
  return sent;
}

