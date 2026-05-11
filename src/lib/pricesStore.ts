// Store aislado de precios. Cada componente se suscribe SOLO al ticker que muestra,
// evitando re-renders globales cuando llegan actualizaciones por SSE.
import { create } from "zustand";

export type PriceTick = {
  price: number;
  prev: number;
  change_pct: number; // diaria (snapshot REST)
  ts: string;
  flash: "up" | "down" | null;
};

type PricesState = {
  bySymbol: Record<string, PriceTick>;
  fxUpdatedAt: string | null;
  setBulk: (
    quotes: Array<{ ticker: string; price_usd: number; change_pct: number; ts: string }>,
  ) => void;
  setOne: (ticker: string, price: number, ts: string) => void;
  clearFlash: (ticker: string) => void;
};

export const usePrices = create<PricesState>((set) => ({
  bySymbol: {},
  fxUpdatedAt: null,
  setBulk: (quotes) =>
    set((state) => {
      const next = { ...state.bySymbol };
      for (const q of quotes) {
        if (!q.price_usd) continue;
        const existing = next[q.ticker];
        next[q.ticker] = {
          price: q.price_usd,
          prev: existing?.price ?? q.price_usd,
          change_pct: q.change_pct,
          ts: q.ts,
          flash: existing && existing.price !== q.price_usd
            ? (q.price_usd > existing.price ? "up" : "down")
            : null,
        };
      }
      return { bySymbol: next, fxUpdatedAt: quotes[0]?.ts ?? state.fxUpdatedAt };
    }),
  setOne: (ticker, price, ts) =>
    set((state) => {
      if (!price || price <= 0) return state;
      const existing = state.bySymbol[ticker];
      if (existing && existing.price === price) return state;
      const flash: "up" | "down" | null = existing
        ? (price > existing.price ? "up" : price < existing.price ? "down" : null)
        : null;
      return {
        bySymbol: {
          ...state.bySymbol,
          [ticker]: {
            price,
            prev: existing?.price ?? price,
            change_pct: existing?.change_pct ?? 0,
            ts,
            flash,
          },
        },
      };
    }),
  clearFlash: (ticker) =>
    set((state) => {
      const t = state.bySymbol[ticker];
      if (!t || !t.flash) return state;
      return { bySymbol: { ...state.bySymbol, [ticker]: { ...t, flash: null } } };
    }),
}));

// Hook por-ticker: solo re-renderiza cuando cambia ese ticker.
export function usePriceFor(symbol: string): PriceTick | undefined {
  return usePrices((s) => s.bySymbol[symbol]);
}
