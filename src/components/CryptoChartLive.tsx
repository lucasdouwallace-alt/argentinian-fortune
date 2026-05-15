import { useEffect, useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCryptoBars } from "@/lib/crypto.functions";

type Tf = "1Hour" | "4Hour" | "1Day" | "1Week";
type Bar = { t: string; o: number; h: number; l: number; c: number; v: number };

const TF_LABEL: Record<Tf, string> = { "1Hour": "1H", "4Hour": "4H", "1Day": "1D", "1Week": "1W" };
const TF_LIMIT: Record<Tf, number> = { "1Hour": 60, "4Hour": 60, "1Day": 60, "1Week": 52 };
const TF_REFRESH_MS: Record<Tf, number> = {
  "1Hour": 30_000,
  "4Hour": 3 * 60_000,
  "1Day": 10 * 60_000,
  "1Week": 60 * 60_000,
};

const W = 600;
const H = 260;
const PAD = { top: 12, right: 70, bottom: 28, left: 8 };

function formatLabel(iso: string, tf: Tf) {
  const d = new Date(iso);
  if (tf === "1Hour" || tf === "4Hour")
    return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function usdCompact(v: number) {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(6)}`;
}

function CandlestickSVG({ bars, tf }: { bars: Bar[]; tf: Tf }) {
  if (!bars.length) return null;

  const prices = bars.flatMap((b) => [b.h, b.l]);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || maxP * 0.02;
  const padP = range * 0.05;
  const lo = minP - padP;
  const hi = maxP + padP;

  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const toX = (i: number) => PAD.left + (i + 0.5) * (chartW / bars.length);
  const toY = (p: number) => PAD.top + chartH - ((p - lo) / (hi - lo)) * chartH;

  const candleW = Math.max(2, Math.min(12, chartW / bars.length - 2));
  const yTicks = 5;
  const yStep = (hi - lo) / yTicks;
  const xStep = Math.ceil(bars.length / 5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" style={{ display: "block" }}>
      {Array.from({ length: yTicks + 1 }).map((_, i) => {
        const price = lo + i * yStep;
        const y = toY(price);
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
              stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            <text x={W - PAD.right + 4} y={y + 4} fontSize={9}
              fill="rgba(160,160,180,0.8)" textAnchor="start">
              {usdCompact(price)}
            </text>
          </g>
        );
      })}

      {bars.map((b, i) => {
        if (i % xStep !== 0) return null;
        return (
          <text key={i} x={toX(i)} y={H - 6} fontSize={9}
            fill="rgba(160,160,180,0.7)" textAnchor="middle">
            {formatLabel(b.t, tf)}
          </text>
        );
      })}

      {bars.map((b, i) => {
        const x = toX(i);
        const isUp = b.c >= b.o;
        const color = isUp ? "#22c55e" : "#ef4444";
        const bodyTop = toY(Math.max(b.o, b.c));
        const bodyBot = toY(Math.min(b.o, b.c));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        return (
          <g key={i}>
            <line x1={x} y1={toY(b.h)} x2={x} y2={toY(b.l)}
              stroke={color} strokeWidth={1} />
            <rect x={x - candleW / 2} y={bodyTop} width={candleW} height={bodyH}
              fill={color} fillOpacity={0.9} rx={1} />
          </g>
        );
      })}

      {bars.length > 0 && (() => {
        const b = bars[bars.length - 1];
        const x = toX(bars.length - 1);
        const priceY = toY(b.c);
        return (
          <g>
            <line x1={PAD.left} y1={priceY} x2={W - PAD.right} y2={priceY}
              stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="3 3" />
            <rect x={W - PAD.right + 3} y={priceY - 8} width={62} height={16}
              fill={b.c >= b.o ? "#22c55e" : "#ef4444"} rx={3} />
            <text x={W - PAD.right + 34} y={priceY + 4} fontSize={9}
              fill="white" textAnchor="middle" fontWeight="bold">
              {usdCompact(b.c)}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

export function CryptoChartLive({ symbol, ticker }: { symbol: string; ticker: string }) {
  const fetchBars = useServerFn(getCryptoBars);
  const [tf, setTf] = useState<Tf>("1Hour");
  const [bars, setBars] = useState<Bar[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBars = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const { bars: raw } = await fetchBars({ data: { symbol, timeframe: tf, limit: TF_LIMIT[tf] } });
      const valid = raw.filter((b) => b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0);
      if (isRefresh && valid.length > 0) {
        setBars((prev) => {
          if (!prev.length) return valid;
          const updated = [...prev];
          updated[updated.length - 1] = valid[valid.length - 1];
          return updated;
        });
      } else {
        setBars(valid);
      }
      setLastUpdate(new Date());
    } catch (e) {
      console.error("[chart]", e);
    } finally {
      setLoading(false);
    }
  }, [symbol, tf, fetchBars]);

  useEffect(() => { loadBars(false); }, [loadBars]);

  useEffect(() => {
    const id = setInterval(() => loadBars(true), TF_REFRESH_MS[tf]);
    return () => clearInterval(id);
  }, [tf, loadBars]);

  return (
    <div className="bg-secondary/20 border rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm">{ticker}/USD</span>
          <span className="text-xs text-muted-foreground">
            {loading ? "Cargando…" : `${bars.length} velas · ${TF_LABEL[tf]}`}
          </span>
          {lastUpdate && (
            <span className="text-xs text-success inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-success animate-pulse inline-block" />
              {lastUpdate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {(Object.keys(TF_LABEL) as Tf[]).map((t) => (
            <button key={t} onClick={() => setTf(t)}
              className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${tf === t ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground hover:bg-secondary"}`}>
              {TF_LABEL[t]}
            </button>
          ))}
          <button onClick={() => loadBars(false)}
            className="px-2 py-0.5 rounded text-xs bg-secondary/60 text-muted-foreground hover:bg-secondary">↺</button>
        </div>
      </div>

      <div className="relative w-full" style={{ height: 260 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-card/50 rounded">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-3 rounded-full border-2 border-primary border-t-transparent animate-spin inline-block" />
              Cargando velas…
            </div>
          </div>
        )}
        {!loading && bars.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Sin datos para este timeframe
          </div>
        )}
        <CandlestickSVG bars={bars} tf={tf} />
      </div>
    </div>
  );
}
