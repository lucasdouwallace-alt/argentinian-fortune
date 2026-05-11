import { memo, useEffect } from "react";
import { usePriceFor, usePrices } from "@/lib/pricesStore";
import { usd, ars } from "@/lib/format";
import { TrendingDown, TrendingUp } from "lucide-react";

type Props = { symbol: string; ccl: number };

function PriceCellImpl({ symbol, ccl }: Props) {
  const tick = usePriceFor(symbol);
  const clearFlash = usePrices((s) => s.clearFlash);

  useEffect(() => {
    if (tick?.flash) {
      const id = setTimeout(() => clearFlash(symbol), 320);
      return () => clearTimeout(id);
    }
  }, [tick?.flash, tick?.ts, symbol, clearFlash]);

  if (!tick || !tick.price) {
    return <span className="text-muted-foreground">…</span>;
  }
  const flashCls =
    tick.flash === "up"
      ? "bg-success/25 ring-1 ring-success/40"
      : tick.flash === "down"
        ? "bg-destructive/25 ring-1 ring-destructive/40"
        : "";
  const ch = tick.change_pct;
  const arsLabel = ccl > 0 ? ars(tick.price * ccl) : "Sin CCL";
  return (
    <span className="inline-flex items-center gap-3 flex-wrap font-mono" data-mono>
      <span className={`px-1.5 py-0.5 rounded transition-colors duration-300 ${flashCls}`}>
        {usd(tick.price)}
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground text-xs">{arsLabel}</span>
      {ch !== 0 && (
        <span
          className={`inline-flex items-center gap-1 text-xs ${ch >= 0 ? "text-success" : "text-destructive"}`}
        >
          {ch >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          {ch >= 0 ? "+" : ""}
          {ch.toFixed(2)}%
        </span>
      )}
    </span>
  );
}

export const PriceCell = memo(PriceCellImpl);
