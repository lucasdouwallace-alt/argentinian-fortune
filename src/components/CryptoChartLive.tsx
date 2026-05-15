import { useEffect, useRef, useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCryptoBars } from "@/lib/crypto.functions";

type Tf = "1Hour" | "4Hour" | "1Day" | "1Week";

const TF_LABEL: Record<Tf, string> = { "1Hour": "1H", "4Hour": "4H", "1Day": "1D", "1Week": "1W" };
const TF_LIMIT: Record<Tf, number> = { "1Hour": 72, "4Hour": 90, "1Day": 90, "1Week": 52 };
const TF_REFRESH_MS: Record<Tf, number> = {
  "1Hour": 30_000,
  "4Hour": 3 * 60_000,
  "1Day": 10 * 60_000,
  "1Week": 60 * 60_000,
};

export function CryptoChartLive({ symbol, ticker }: { symbol: string; ticker: string }) {
  const fetchBars = useServerFn(getCryptoBars);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const [tf, setTf] = useState<Tf>("1Hour");
  const [barCount, setBarCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  // Crear chart — carga lightweight-charts dinámicamente (solo en el browser)
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (destroyed || !containerRef.current) return;

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "rgba(160,160,180,1)",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.04)" },
          horzLines: { color: "rgba(255,255,255,0.04)" },
        },
        crosshair: {
          vertLine: { color: "rgba(255,255,255,0.2)", width: 1, style: 3 },
          horzLine: { color: "rgba(255,255,255,0.2)", width: 1, style: 3 },
        },
        rightPriceScale: {
          borderColor: "rgba(255,255,255,0.08)",
          scaleMargins: { top: 0.08, bottom: 0.08 },
        },
        timeScale: {
          borderColor: "rgba(255,255,255,0.08)",
          timeVisible: true,
          secondsVisible: false,
        },
        width: containerRef.current.clientWidth,
        height: 260,
      });

      const series = chart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderUpColor: "#22c55e",
        borderDownColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
      });

      chartRef.current = chart;
      seriesRef.current = series;
      setReady(true);

      const handleResize = () => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
      };
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
      };
    });

    return () => {
      destroyed = true;
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      setReady(false);
    };
  }, []);

  // Cargar barras
  const loadBars = useCallback(async (isRefresh = false) => {
    if (!seriesRef.current) return;
    if (!isRefresh) setLoading(true);
    try {
      const { bars } = await fetchBars({ data: { symbol, timeframe: tf, limit: TF_LIMIT[tf] } });
      if (!seriesRef.current) return;

      const candles = bars
        .filter((b) => b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0)
        .map((b) => ({
          time: Math.floor(new Date(b.t).getTime() / 1000) as any,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        }));

      if (isRefresh && candles.length > 0) {
        seriesRef.current.update(candles[candles.length - 1]);
      } else {
        seriesRef.current.setData(candles);
        chartRef.current?.timeScale().fitContent();
      }
      setBarCount(candles.length);
      setLastUpdate(new Date());
    } catch (e) {
      console.error("[chart]", e);
    } finally {
      setLoading(false);
    }
  }, [symbol, tf, fetchBars]);

  // Carga inicial y cambio de símbolo/timeframe — espera a que el chart esté listo
  useEffect(() => {
    if (!ready) return;
    loadBars(false);
  }, [ready, loadBars]);

  // Auto-refresh
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => loadBars(true), TF_REFRESH_MS[tf]);
    return () => clearInterval(id);
  }, [ready, tf, loadBars]);

  return (
    <div className="bg-secondary/20 border rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-bold text-sm">{ticker}/USD</span>
          <span className="text-xs text-muted-foreground ml-2">
            {loading ? "Cargando…" : `${barCount} velas · ${TF_LABEL[tf]}`}
          </span>
          {lastUpdate && (
            <span className="text-xs text-success ml-2 inline-flex items-center gap-1">
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
            className="px-2 py-0.5 rounded text-xs bg-secondary/60 text-muted-foreground hover:bg-secondary" title="Recargar">
            ↺
          </button>
        </div>
      </div>

      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-card/60 rounded">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-3 rounded-full border-2 border-primary border-t-transparent animate-spin inline-block" />
              Cargando velas…
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full" />
      </div>
    </div>
  );
}
